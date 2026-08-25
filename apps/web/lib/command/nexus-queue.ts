// Nexus queue countdown for Event Day Command and the pit display.
//
// Everything here is pure so the countdown can be unit-tested and so the client
// can re-render it every second without another round trip. Nothing is invented:
// a match Nexus did not post is null, a queue time Nexus did not post is null,
// and a null renders as a dash, never as a guessed clock.

import {
  nexusClockOffsetMs,
  nexusCountdownMs,
  nexusStageLabel,
  type NexusAnnouncement,
  type NexusEventSnapshot,
  type NexusMatch,
  type NexusPartsRequest,
  type NexusQueueStage,
} from "@vantage/reference";

/** The audit demanded a red QUEUE SOON inside five minutes. */
export const NEXUS_QUEUE_URGENT_MS = 5 * 60_000;
/** How many announcements the feed keeps. */
export const NEXUS_ANNOUNCEMENT_LIMIT = 5;
export const NEXUS_PARTS_LIMIT = 6;
export const NEXUS_OUR_MATCH_LIMIT = 3;

export type NexusPartsRequestNear = NexusPartsRequest & {
  /** True only when BOTH pit addresses are known and share a row. */
  nearby: boolean;
};

/** Everything the queue panel needs, computed once on the server. */
export type NexusQueueSnapshot = {
  /** Nexus' own clock at fetch time — the basis for drift correction. */
  serverNowMs: number | null;
  /** Milliseconds the cached payload had already aged when we stored it. */
  fetchedAtMs: number | null;
  ourPitAddress: string | null;
  ourMatches: NexusMatch[];
  announcements: NexusAnnouncement[];
  partsRequests: NexusPartsRequestNear[];
};

export function emptyNexusQueueSnapshot(): NexusQueueSnapshot {
  return {
    serverNowMs: null,
    fetchedAtMs: null,
    ourPitAddress: null,
    ourMatches: [],
    announcements: [],
    partsRequests: [],
  };
}

/** Leading letters of a pit address ("B-14" -> "B"). Null when unparseable. */
export function pitRow(address: string | null | undefined): string | null {
  if (typeof address !== "string") return null;
  const match = address.trim().toUpperCase().match(/^[A-Z]+/);
  return match ? match[0] : null;
}

/** "Near you" is only claimed when both addresses are known and share a row. */
export function pitsAreNear(a: string | null | undefined, b: string | null | undefined): boolean {
  const rowA = pitRow(a);
  const rowB = pitRow(b);
  return Boolean(rowA && rowB && rowA === rowB);
}

function matchIncludes(match: NexusMatch, teamNumber: string): boolean {
  return match.redTeams.includes(teamNumber) || match.blueTeams.includes(teamNumber);
}

function postedAt(entry: { postedAtMs: number | null }): number {
  return entry.postedAtMs ?? Number.NEGATIVE_INFINITY;
}

/**
 * Fold a cached Nexus event payload plus the /pits address book into the queue
 * panel view. An org with no team number still gets announcements and parts
 * requests; it just gets no "our match".
 */
export function buildNexusQueueSnapshot(input: {
  event: NexusEventSnapshot | null;
  pits: Record<string, string> | null;
  teamNumber: number | null;
}): NexusQueueSnapshot {
  const { event } = input;
  if (!event) return emptyNexusQueueSnapshot();

  const pits = input.pits ?? {};
  const teamNumber = input.teamNumber != null ? String(input.teamNumber) : null;
  const ourPitAddress = teamNumber ? (pits[teamNumber] ?? null) : null;

  const ourMatches = teamNumber
    ? event.matches.filter((match) => matchIncludes(match, teamNumber)).slice(0, NEXUS_OUR_MATCH_LIMIT)
    : [];

  const announcements = [...event.announcements]
    .sort((a, b) => postedAt(b) - postedAt(a))
    .slice(0, NEXUS_ANNOUNCEMENT_LIMIT);

  const partsRequests = [...event.partsRequests]
    .filter((request) => request.status == null || request.status.toLowerCase() !== "resolved")
    .sort((a, b) => postedAt(b) - postedAt(a))
    .slice(0, NEXUS_PARTS_LIMIT)
    .map((request) => {
      const pitAddress =
        request.pitAddress ?? (request.requestedByTeam ? (pits[request.requestedByTeam] ?? null) : null);
      return {
        ...request,
        pitAddress,
        nearby: pitsAreNear(pitAddress, ourPitAddress),
      };
    });

  const fetchedAtMs = Date.parse(event.fetchedAt);

  return {
    serverNowMs: event.serverNowMs,
    fetchedAtMs: Number.isNaN(fetchedAtMs) ? null : fetchedAtMs,
    ourPitAddress,
    ourMatches,
    announcements,
    partsRequests,
  };
}

export type NexusQueueCue = "QUEUE NOW" | "QUEUE SOON" | "ON DECK" | "ON FIELD" | "STAND BY" | null;

export type NexusQueueCountdown = {
  match: NexusMatch | null;
  stage: NexusQueueStage;
  stageLabel: string | null;
  /** Milliseconds until the posted queue time, drift-corrected. Null = not posted. */
  countdownMs: number | null;
  /** m:ss, or "—" when Nexus posted no queue time. */
  label: string;
  urgent: boolean;
  overdue: boolean;
  cue: NexusQueueCue;
};

export function formatQueueCountdown(ms: number | null): string {
  if (ms === null) return "—";
  const clamped = Math.max(0, ms);
  const minutes = Math.floor(clamped / 60_000);
  const seconds = Math.floor((clamped % 60_000) / 1_000);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * The live countdown. `nowMs` is this device's clock; the offset from the Nexus
 * server clock (captured at fetch time) is applied so a laptop with a skewed
 * clock still queues on the field's time.
 */
export function nexusQueueCountdown(
  snapshot: NexusQueueSnapshot | null,
  nowMs: number,
): NexusQueueCountdown {
  const match = snapshot?.ourMatches[0] ?? null;
  // The offset was measured when the payload was fetched, not now.
  const offsetMs = nexusClockOffsetMs(snapshot?.serverNowMs ?? null, snapshot?.fetchedAtMs ?? nowMs);
  const target = match?.estimatedQueueTime ?? null;
  const countdownMs = nexusCountdownMs(target, nowMs, offsetMs);
  const stage = match?.stage ?? "unknown";
  const overdue = countdownMs !== null && countdownMs <= 0;
  const urgent = stage === "now_queuing" || overdue || (countdownMs !== null && countdownMs <= NEXUS_QUEUE_URGENT_MS);

  let cue: NexusQueueCue = null;
  if (match) {
    if (stage === "on_field") cue = "ON FIELD";
    else if (stage === "on_deck") cue = "ON DECK";
    else if (stage === "now_queuing" || overdue) cue = "QUEUE NOW";
    else if (countdownMs !== null && countdownMs <= NEXUS_QUEUE_URGENT_MS) cue = "QUEUE SOON";
    else cue = "STAND BY";
  }

  return {
    match,
    stage,
    stageLabel: nexusStageLabel(stage),
    countdownMs,
    label: formatQueueCountdown(countdownMs),
    urgent: Boolean(match) && urgent,
    overdue,
    cue,
  };
}

/** True when there is anything real to render — otherwise show setup guidance. */
export function hasNexusQueueSignal(snapshot: NexusQueueSnapshot | null | undefined): boolean {
  if (!snapshot) return false;
  return (
    snapshot.ourMatches.length > 0 ||
    snapshot.announcements.length > 0 ||
    snapshot.partsRequests.length > 0
  );
}
