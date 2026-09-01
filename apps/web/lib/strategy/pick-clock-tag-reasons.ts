/**
 * Drive-team tags → Pick Clock glance reasons.
 *
 * Qualitative tags used to stop at the team-tags board. This helper projects
 * event-robot tags through `loadTeamTagPickReasons` / `pickReasonsFromTeamTags`
 * and merges `{ label, tone }` onto a clock recommendation. Empty until a real
 * event tag exists — never DEMO tags.
 *
 * Route one-liner (GET, after `recommendNextPick`; after the justifier overlay
 * if that wire is in):
 *
 *   clock = await applyTeamTagReasonsToPickClock(client, {
 *     orgId: desk.orgId,
 *     eventKey: desk.eventKey,
 *     result: clock,
 *   });
 *
 * Do not teach pick-clock-board.ts or the client how to read tag tables.
 */

import type { PoolClient } from "@neondatabase/serverless";
import {
  loadTeamTagPickReasons,
  pickReasonsFromTeamTags,
  type TeamTagAssignment,
  type TeamTagPickReason,
} from "../team-tags";
import type { PickClockReason } from "./pick-clock";

const CLOCK_REASON_CAP = 4;

export type PickClockTagReasonCarrier = {
  teamKey: string;
  teamNumber?: number | null;
  reasons: PickClockReason[];
};

export type PickClockTagResultCarrier<T extends PickClockTagReasonCarrier> = {
  recommendation: T | null;
  alternates: T[];
};

function isDemoTagText(value: string | null | undefined): boolean {
  return typeof value === "string" && /demo/i.test(value);
}

function hasRealEventKey(eventKey: string | null | undefined): eventKey is string {
  return typeof eventKey === "string" && eventKey.trim() !== "";
}

function normalizeReasonKey(label: string): string {
  return label.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Resolve the robot number the tag tables store. Falls back to `frcNNNN`. */
export function teamNumberFromPickClockTeam(input: {
  teamNumber?: number | null;
  teamKey?: string | null;
}): number | null {
  if (input.teamNumber != null && Number.isFinite(input.teamNumber) && input.teamNumber > 0) {
    return Math.floor(input.teamNumber);
  }
  const match = /^frc(\d+)$/i.exec(input.teamKey?.trim() ?? "");
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Keep only glance fields. Drop DEMO slugs/labels instead of inventing a substitute. */
export function toPickClockReason(reason: TeamTagPickReason): PickClockReason | null {
  const label = reason.label.trim();
  if (!label || isDemoTagText(label) || isDemoTagText(reason.tagSlug)) return null;
  return { label, tone: reason.tone };
}

/**
 * Tag lines first, then existing clock lines. Dedupes by label and caps to the
 * glance screen. Empty tag input leaves `existing` unchanged (still capped).
 */
export function mergeTeamTagReasonsIntoClock(
  existing: readonly PickClockReason[],
  tagReasons: readonly TeamTagPickReason[],
  max = CLOCK_REASON_CAP,
): PickClockReason[] {
  const cap = Math.max(0, max);
  const seen = new Set<string>();
  const out: PickClockReason[] = [];

  const push = (line: PickClockReason) => {
    const key = normalizeReasonKey(line.label);
    if (!key || seen.has(key) || out.length >= cap) return;
    seen.add(key);
    out.push({ label: line.label, tone: line.tone });
  };

  for (const reason of tagReasons) {
    const line = toPickClockReason(reason);
    if (line) push(line);
  }
  for (const reason of existing) {
    push(reason);
  }
  return out;
}

export function indexTeamTagReasonsByTeam(
  reasons: readonly TeamTagPickReason[],
): Map<number, TeamTagPickReason[]> {
  const map = new Map<number, TeamTagPickReason[]>();
  for (const reason of reasons) {
    if (!reason.teamNumber || isDemoTagText(reason.label) || isDemoTagText(reason.tagSlug)) continue;
    const list = map.get(reason.teamNumber) ?? [];
    list.push(reason);
    map.set(reason.teamNumber, list);
  }
  return map;
}

/**
 * Sync projection for one robot. Requires an event key — unscoped / blank
 * events stay empty so the clock never shows leftover season tags.
 */
export function pickClockTagReasonsFromAssignments(
  assignments: readonly TeamTagAssignment[],
  input: { teamNumber: number; eventKey?: string | null; limit?: number },
): TeamTagPickReason[] {
  if (!hasRealEventKey(input.eventKey)) return [];
  return pickReasonsFromTeamTags(assignments, {
    teamNumber: input.teamNumber,
    eventKey: input.eventKey,
    limit: input.limit,
  }).filter((reason) => toPickClockReason(reason) != null);
}

export function applyTeamTagReasonsToRecommendation<T extends PickClockTagReasonCarrier>(
  recommendation: T,
  tags: readonly TeamTagPickReason[] | ReadonlyMap<number, TeamTagPickReason[]>,
): T {
  const teamNumber = teamNumberFromPickClockTeam(recommendation);
  if (teamNumber == null) return recommendation;
  const tagReasons =
    tags instanceof Map
      ? (tags.get(teamNumber) ?? [])
      : Array.isArray(tags)
        ? tags.filter((reason) => reason.teamNumber === teamNumber)
        : [];
  if (!tagReasons.length) return recommendation;
  return {
    ...recommendation,
    reasons: mergeTeamTagReasonsIntoClock(recommendation.reasons, tagReasons),
  };
}

/** Overlay event-robot tags on the primary recommendation and every alternate. */
export function applyTeamTagReasonsToPickClockResult<T extends PickClockTagReasonCarrier>(
  result: PickClockTagResultCarrier<T>,
  tags: readonly TeamTagPickReason[],
): PickClockTagResultCarrier<T> {
  if (!tags.length) return result;
  const byTeam = indexTeamTagReasonsByTeam(tags);
  if (byTeam.size === 0) return result;
  return {
    ...result,
    recommendation: result.recommendation
      ? applyTeamTagReasonsToRecommendation(result.recommendation, byTeam)
      : null,
    alternates: result.alternates.map((alt) => applyTeamTagReasonsToRecommendation(alt, byTeam)),
  };
}

/**
 * Sync merge from already-loaded assignments. No event / no tags → unchanged.
 */
export function mergePickClockTagReasonsFromAssignments<T extends PickClockTagReasonCarrier>(
  result: PickClockTagResultCarrier<T>,
  assignments: readonly TeamTagAssignment[],
  eventKey: string | null | undefined,
): PickClockTagResultCarrier<T> {
  if (!hasRealEventKey(eventKey) || !assignments.length) return result;
  const teamNumbers = new Set<number>();
  const collect = (row: T | null) => {
    const teamNumber = row ? teamNumberFromPickClockTeam(row) : null;
    if (teamNumber != null) teamNumbers.add(teamNumber);
  };
  collect(result.recommendation);
  for (const alt of result.alternates) collect(alt);
  const tags = [...teamNumbers].flatMap((teamNumber) =>
    pickClockTagReasonsFromAssignments(assignments, { teamNumber, eventKey }),
  );
  return applyTeamTagReasonsToPickClockResult(result, tags);
}

/**
 * Load event tags through the request RLS client and overlay them.
 * Missing tables, a blank event, or no applied tags leave `result` unchanged.
 */
export async function applyTeamTagReasonsToPickClock<T extends PickClockTagReasonCarrier>(
  client: PoolClient,
  input: {
    orgId: string;
    eventKey: string | null | undefined;
    result: PickClockTagResultCarrier<T>;
    seasonYear?: number;
  },
): Promise<PickClockTagResultCarrier<T>> {
  if (!hasRealEventKey(input.eventKey)) return input.result;
  const tags = await loadTeamTagPickReasons(client, {
    orgId: input.orgId,
    eventKey: input.eventKey,
    seasonYear: input.seasonYear,
  });
  return applyTeamTagReasonsToPickClockResult(input.result, tags);
}
