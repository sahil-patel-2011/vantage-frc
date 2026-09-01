/**
 * Drive-team tags as pick-clock reasons.
 *
 * qualitative_team_tags used to stop at this feature's board. Pick clock (and any
 * other consumer) can import these helpers and merge `{ label, tone }` into its
 * reasons array. Empty input stays empty — no DEMO labels, no invented tags.
 */

import { assignmentsForEvent, type TeamTagAssignment } from "./group";

export type TeamTagPickReasonTone = "strong" | "caution" | "neutral";

export type TeamTagPickReason = {
  /** Glanceable line — same shape pick-clock already renders. */
  label: string;
  tone: TeamTagPickReasonTone;
  tagSlug: string;
  teamNumber: number;
  source: "drive_team_tag";
};

const STRONG_SLUGS = new Set(["defense", "strong_auto", "good_partner"]);
const CAUTION_SLUGS = new Set(["no_climb", "slow_cycles", "unreliable"]);

export function pickReasonToneForSlug(slug: string): TeamTagPickReasonTone {
  if (STRONG_SLUGS.has(slug)) return "strong";
  if (CAUTION_SLUGS.has(slug)) return "caution";
  return "neutral";
}

export function formatTeamTagPickLabel(tagName: string, notes?: string | null): string {
  const name = tagName.trim();
  const note = notes?.trim();
  if (!name) return "";
  if (!note) return name;
  return `${name} — ${note.slice(0, 60)}`;
}

/**
 * Glanceable pick reasons for one robot. Pass `eventKey` to keep only tags
 * written on that event; omit it to read every assignment for the team.
 */
export function pickReasonsFromTeamTags(
  assignments: readonly TeamTagAssignment[],
  input: {
    teamNumber: number;
    eventKey?: string | null;
    limit?: number;
  },
): TeamTagPickReason[] {
  if (!Number.isFinite(input.teamNumber) || input.teamNumber <= 0) return [];
  const scoped =
    input.eventKey != null && input.eventKey !== ""
      ? assignmentsForEvent(assignments, input.eventKey)
      : [...assignments];
  const bySlug = new Map<string, TeamTagAssignment>();
  for (const row of scoped) {
    if (row.teamNumber !== input.teamNumber) continue;
    const existing = bySlug.get(row.tagSlug);
    if (!existing || (!existing.notes && row.notes)) {
      bySlug.set(row.tagSlug, row);
    }
  }
  const reasons: TeamTagPickReason[] = [];
  for (const row of bySlug.values()) {
    const label = formatTeamTagPickLabel(row.tagName, row.notes);
    if (!label) continue;
    reasons.push({
      label,
      tone: pickReasonToneForSlug(row.tagSlug),
      tagSlug: row.tagSlug,
      teamNumber: row.teamNumber,
      source: "drive_team_tag",
    });
  }
  reasons.sort((a, b) => a.label.localeCompare(b.label));
  const limit = input.limit;
  if (limit != null && Number.isFinite(limit) && limit >= 0) {
    return reasons.slice(0, Math.floor(limit));
  }
  return reasons;
}

/** Every event-robot tag as a pick reason. No event / no tags → empty. */
export function pickReasonsForEvent(
  assignments: readonly TeamTagAssignment[],
  eventKey: string | null | undefined,
): TeamTagPickReason[] {
  const scoped = assignmentsForEvent(assignments, eventKey);
  if (!scoped.length) return [];
  const teams = [...new Set(scoped.map((row) => row.teamNumber))].sort((a, b) => a - b);
  return teams.flatMap((teamNumber) =>
    pickReasonsFromTeamTags(scoped, { teamNumber, eventKey: eventKey ?? undefined }),
  );
}
