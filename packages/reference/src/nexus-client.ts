import { readJson, UpstreamHttpError } from "./http";

const NEXUS_BASE = "https://frc.nexus/api/v1";

export type NexusLiveEvent = {
  eventKey: string;
  queuedMatchKey: string | null;
  nowQueuing: string | null;
  fetchedAt: string;
};

export type NexusPitAddresses = Record<string, string>;

export class NexusClient {
  constructor(
    private readonly options: {
      apiKey: string;
      baseUrl?: string;
      fetch?: typeof fetch;
    },
  ) {
    if (!options.apiKey.trim()) throw new Error("Nexus API key is required");
  }

  private async get<T>(resource: string): Promise<T> {
    const base = (this.options.baseUrl ?? NEXUS_BASE).replace(/\/$/, "");
    const path = resource.replace(/^\//, "");
    const response = await (this.options.fetch ?? fetch)(`${base}/${path}`, {
      headers: {
        "Nexus-Api-Key": this.options.apiKey,
        accept: "application/json",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      throw new UpstreamHttpError("Nexus", response.status, path, null);
    }
    return (await readJson(response, "Nexus", path)) as T;
  }

  /** Live queue status. Empty/null fields stay null — never invent now-queuing. */
  async getLive(eventKey: string): Promise<unknown> {
    return this.get(`event/${encodeURIComponent(eventKey)}`);
  }

  async getPits(eventKey: string): Promise<NexusPitAddresses> {
    const body = await this.get<Record<string, string>>(`event/${encodeURIComponent(eventKey)}/pits`);
    return body && typeof body === "object" ? body : {};
  }

  /**
   * Full event payload: matches[] with the queue state machine, announcements[],
   * partsRequests[], and the Nexus server clock. Parsed tolerantly.
   */
  async getEvent(eventKey: string, fetchedAt = new Date().toISOString()): Promise<NexusEventSnapshot> {
    const body = await this.getLive(eventKey);
    return parseNexusEvent(body, eventKey, fetchedAt);
  }

  /** Venue pit-map geometry. Empty geometry is a valid answer — never a stub map. */
  async getMap(eventKey: string): Promise<NexusMapGeometry> {
    const body = await this.get<unknown>(`event/${encodeURIComponent(eventKey)}/map`);
    return parseNexusMap(body);
  }
}

export function nexusAttributionHref(): string {
  return "https://frc.nexus";
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

/** Map a Nexus live payload without inventing queue text. */
export function parseNexusLive(body: unknown, eventKey: string, fetchedAt: string): NexusLiveEvent {
  if (!body || typeof body !== "object") {
    return { eventKey, queuedMatchKey: null, nowQueuing: null, fetchedAt };
  }
  const record = body as Record<string, unknown>;
  return {
    eventKey,
    queuedMatchKey:
      asTrimmedString(record.queuedMatchKey) ??
      asTrimmedString(record.queued_match_key) ??
      asTrimmedString(record.matchKey) ??
      null,
    nowQueuing:
      asTrimmedString(record.nowQueuing) ??
      asTrimmedString(record.now_queuing) ??
      asTrimmedString(record.nowQueuingMatch) ??
      null,
    fetchedAt,
  };
}

/* ------------------------------------------------------------------ *
 * Nexus event deepening — matches[], announcements[], partsRequests[],
 * /map geometry, and the server clock used for drift correction.
 * Every field is optional on purpose: a missing field renders nothing,
 * it never becomes a fabricated value.
 * ------------------------------------------------------------------ */

/** Nexus queue state machine: Queuing soon -> Now queuing -> On deck -> On field. */
export type NexusQueueStage = "queuing_soon" | "now_queuing" | "on_deck" | "on_field" | "unknown";

export const NEXUS_QUEUE_STAGES: ReadonlyArray<{ stage: NexusQueueStage; label: string }> = [
  { stage: "queuing_soon", label: "Queuing soon" },
  { stage: "now_queuing", label: "Now queuing" },
  { stage: "on_deck", label: "On deck" },
  { stage: "on_field", label: "On field" },
];

/** Position of a stage in the state machine, or -1 when Nexus posted nothing we recognise. */
export function nexusStageIndex(stage: NexusQueueStage): number {
  return NEXUS_QUEUE_STAGES.findIndex((entry) => entry.stage === stage);
}

/** Map a raw Nexus status string onto the state machine. Unknown text stays "unknown". */
export function nexusQueueStage(status: unknown): NexusQueueStage {
  const text = asTrimmedString(status)?.toLowerCase();
  if (!text) return "unknown";
  const squashed = text.replace(/[\s_-]+/g, " ");
  if (squashed.includes("on field") || squashed.includes("onfield")) return "on_field";
  if (squashed.includes("on deck") || squashed.includes("ondeck")) return "on_deck";
  if (squashed.includes("now queuing") || squashed.includes("nowqueuing")) return "now_queuing";
  if (squashed.includes("queuing soon") || squashed.includes("queuingsoon")) return "queuing_soon";
  return "unknown";
}

export function nexusStageLabel(stage: NexusQueueStage): string | null {
  return NEXUS_QUEUE_STAGES.find((entry) => entry.stage === stage)?.label ?? null;
}

export type NexusMatch = {
  /** Nexus label, e.g. "Qualification 12". Null when the payload omitted it. */
  label: string | null;
  matchKey: string | null;
  /** Raw Nexus status text, preserved for display/attribution. */
  status: string | null;
  stage: NexusQueueStage;
  /** Team numbers as strings, exactly as Nexus posted them. */
  redTeams: string[];
  blueTeams: string[];
  estimatedQueueTime: number | null;
  estimatedStartTime: number | null;
  scheduledStartTime: number | null;
  actualQueueTime: number | null;
  actualStartTime: number | null;
};

export type NexusAnnouncement = {
  id: string | null;
  message: string;
  postedAtMs: number | null;
};

export type NexusPartsRequest = {
  id: string | null;
  /** What the requesting team needs, verbatim. */
  parts: string;
  requestedByTeam: string | null;
  /** Pit address when Nexus carried one inline; otherwise resolved from /pits. */
  pitAddress: string | null;
  postedAtMs: number | null;
  status: string | null;
};

export type NexusEventSnapshot = {
  eventKey: string;
  fetchedAt: string;
  /** Nexus' own "now" epoch ms — the basis for clock drift correction. */
  serverNowMs: number | null;
  dataAsOfMs: number | null;
  nowQueuing: string | null;
  queuedMatchKey: string | null;
  matches: NexusMatch[];
  announcements: NexusAnnouncement[];
  partsRequests: NexusPartsRequest[];
};

export type NexusMapShape = {
  id: string | null;
  label: string | null;
  /** Team number when this shape is a pit Nexus attributed to a team. */
  teamNumber: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
};

export type NexusMapGeometry = {
  width: number | null;
  height: number | null;
  pits: NexusMapShape[];
  areas: NexusMapShape[];
};

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
    const asDate = Date.parse(value);
    return Number.isNaN(asDate) ? null : asDate;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Nexus posts team numbers as strings; tolerate numbers and nested objects. */
function asTeamList(value: unknown): string[] {
  return asArray(value)
    .map((entry) => {
      if (typeof entry === "number" && Number.isFinite(entry)) return String(entry);
      const direct = asTrimmedString(entry);
      if (direct) return direct;
      const record = asRecord(entry);
      if (!record) return null;
      const nested = record.teamNumber ?? record.team ?? record.number;
      if (typeof nested === "number" && Number.isFinite(nested)) return String(nested);
      return asTrimmedString(nested);
    })
    .filter((entry): entry is string => Boolean(entry));
}

function pick(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function parseNexusMatch(raw: unknown): NexusMatch | null {
  const record = asRecord(raw);
  if (!record) return null;
  const times = asRecord(record.times) ?? record;
  const status = asTrimmedString(pick(record, ["status", "queueStatus", "state"]));
  return {
    label: asTrimmedString(pick(record, ["label", "name", "matchLabel"])),
    matchKey: asTrimmedString(pick(record, ["matchKey", "match_key", "key"])),
    status,
    stage: nexusQueueStage(status),
    redTeams: asTeamList(pick(record, ["redTeams", "red_teams", "red"])),
    blueTeams: asTeamList(pick(record, ["blueTeams", "blue_teams", "blue"])),
    estimatedQueueTime: asFiniteNumber(
      pick(times, ["estimatedQueueTime", "estimated_queue_time", "queueTime"]),
    ),
    estimatedStartTime: asFiniteNumber(
      pick(times, ["estimatedStartTime", "estimated_start_time", "startTime"]),
    ),
    scheduledStartTime: asFiniteNumber(pick(times, ["scheduledStartTime", "scheduled_start_time"])),
    actualQueueTime: asFiniteNumber(pick(times, ["actualQueueTime", "actual_queue_time"])),
    actualStartTime: asFiniteNumber(pick(times, ["actualStartTime", "actual_start_time"])),
  };
}

function parseNexusAnnouncement(raw: unknown): NexusAnnouncement | null {
  const direct = asTrimmedString(raw);
  if (direct) return { id: null, message: direct, postedAtMs: null };
  const record = asRecord(raw);
  if (!record) return null;
  const message = asTrimmedString(pick(record, ["announcement", "message", "text", "body"]));
  if (!message) return null;
  return {
    id: asTrimmedString(pick(record, ["id", "announcementId"])),
    message,
    postedAtMs: asFiniteNumber(pick(record, ["postedTime", "posted_time", "postedAt", "time"])),
  };
}

function parseNexusPartsRequest(raw: unknown): NexusPartsRequest | null {
  const record = asRecord(raw);
  if (!record) return null;
  const parts = asTrimmedString(pick(record, ["parts", "part", "request", "description", "text"]));
  if (!parts) return null;
  const teamValue = pick(record, ["requestedByTeam", "requested_by_team", "team", "teamNumber"]);
  return {
    id: asTrimmedString(pick(record, ["id", "requestId"])),
    parts,
    requestedByTeam:
      typeof teamValue === "number" && Number.isFinite(teamValue)
        ? String(teamValue)
        : asTrimmedString(teamValue),
    pitAddress: asTrimmedString(pick(record, ["pitAddress", "pit_address", "pit"])),
    postedAtMs: asFiniteNumber(pick(record, ["postedTime", "posted_time", "postedAt", "time"])),
    status: asTrimmedString(pick(record, ["status", "state"])),
  };
}

/**
 * Tolerant parse of `GET /event/{key}`. A payload we cannot read yields empty
 * lists and null clocks — the caller then renders setup guidance, not filler.
 */
export function parseNexusEvent(
  body: unknown,
  eventKey: string,
  fetchedAt: string,
): NexusEventSnapshot {
  const live = parseNexusLive(body, eventKey, fetchedAt);
  const record = asRecord(body);
  if (!record) {
    return {
      eventKey,
      fetchedAt,
      serverNowMs: null,
      dataAsOfMs: null,
      nowQueuing: live.nowQueuing,
      queuedMatchKey: live.queuedMatchKey,
      matches: [],
      announcements: [],
      partsRequests: [],
    };
  }
  return {
    eventKey,
    fetchedAt,
    serverNowMs: asFiniteNumber(pick(record, ["now", "serverTime", "server_now"])),
    dataAsOfMs: asFiniteNumber(pick(record, ["dataAsOfTime", "data_as_of_time", "dataAsOf"])),
    nowQueuing: live.nowQueuing,
    queuedMatchKey: live.queuedMatchKey,
    matches: asArray(pick(record, ["matches", "matchQueue"]))
      .map(parseNexusMatch)
      .filter((match): match is NexusMatch => Boolean(match)),
    announcements: asArray(pick(record, ["announcements", "announcement"]))
      .map(parseNexusAnnouncement)
      .filter((entry): entry is NexusAnnouncement => Boolean(entry)),
    partsRequests: asArray(pick(record, ["partsRequests", "parts_requests", "partRequests"]))
      .map(parseNexusPartsRequest)
      .filter((entry): entry is NexusPartsRequest => Boolean(entry)),
  };
}

function parseNexusShape(raw: unknown): NexusMapShape | null {
  const record = asRecord(raw);
  if (!record) return null;
  const x = asFiniteNumber(pick(record, ["x", "left"]));
  const y = asFiniteNumber(pick(record, ["y", "top"]));
  const width = asFiniteNumber(pick(record, ["width", "w"]));
  const height = asFiniteNumber(pick(record, ["height", "h"]));
  // Geometry without a position or size cannot be drawn — drop it rather than guess.
  if (x === null || y === null || width === null || height === null) return null;
  const teamValue = pick(record, ["team", "teamNumber", "team_number"]);
  return {
    id: asTrimmedString(pick(record, ["id", "key"])),
    label: asTrimmedString(pick(record, ["label", "name", "text"])),
    teamNumber:
      typeof teamValue === "number" && Number.isFinite(teamValue)
        ? String(teamValue)
        : asTrimmedString(teamValue),
    x,
    y,
    width,
    height,
    rotation: asFiniteNumber(pick(record, ["rotation", "angle"])) ?? 0,
  };
}

/** Tolerant parse of `GET /event/{key}/map`. No geometry -> empty lists. */
export function parseNexusMap(body: unknown): NexusMapGeometry {
  const record = asRecord(body);
  if (!record) return { width: null, height: null, pits: [], areas: [] };
  const shapes = (value: unknown) =>
    asArray(value)
      .map(parseNexusShape)
      .filter((shape): shape is NexusMapShape => Boolean(shape));
  return {
    width: asFiniteNumber(pick(record, ["width", "mapWidth"])),
    height: asFiniteNumber(pick(record, ["height", "mapHeight"])),
    pits: shapes(pick(record, ["pits", "pitBoxes"])),
    areas: shapes(pick(record, ["areas", "landmarks", "regions"])),
  };
}

/** True only when the geometry can actually be drawn. */
export function hasNexusMapGeometry(map: NexusMapGeometry | null | undefined): boolean {
  return Boolean(map && (map.pits.length > 0 || map.areas.length > 0));
}

/** Offsets beyond this are treated as garbage, not drift, and ignored. */
export const NEXUS_MAX_CLOCK_OFFSET_MS = 12 * 60 * 60 * 1_000;

/**
 * Drift between the Nexus server clock and this device. Positive means the
 * Nexus clock is ahead of us. A missing or absurd server clock yields 0 so a
 * countdown degrades to local time instead of jumping.
 */
export function nexusClockOffsetMs(
  serverNowMs: number | null | undefined,
  localNowMs: number,
): number {
  if (typeof serverNowMs !== "number" || !Number.isFinite(serverNowMs)) return 0;
  if (!Number.isFinite(localNowMs)) return 0;
  const offset = serverNowMs - localNowMs;
  return Math.abs(offset) > NEXUS_MAX_CLOCK_OFFSET_MS ? 0 : offset;
}

/** Local wall clock translated into Nexus server time. */
export function nexusAdjustedNow(localNowMs: number, offsetMs: number): number {
  return localNowMs + offsetMs;
}

/** Milliseconds until a Nexus timestamp, drift-corrected. Null when there is no target. */
export function nexusCountdownMs(
  targetMs: number | null | undefined,
  localNowMs: number,
  offsetMs: number,
): number | null {
  if (typeof targetMs !== "number" || !Number.isFinite(targetMs)) return null;
  return targetMs - nexusAdjustedNow(localNowMs, offsetMs);
}
