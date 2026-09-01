// Auto / backup / deploy cues for the ONE pre-match briefing card.
//
// Match Strategy Cards already export the same triple via toBriefingMatchCardPayload /
// briefingCuesFromText. Briefing only derives those cues from written card text (and real
// TBA partners when the caller has them). An empty / whitespace-only card yields no cues —
// never DEMO copy, never a fabricated game plan.

import {
  briefingCuesFromText,
  type MatchStrategyBriefingCues,
} from "../match-strategy-cards/briefing-payload";

export type BriefingCardCues = MatchStrategyBriefingCues;

export const EMPTY_BRIEFING_CARD_CUES: BriefingCardCues = {
  auto: null,
  backup: null,
  deploy: null,
};

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function usableRoleCount(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  return value.filter((entry) => {
    if (typeof entry !== "object" || entry === null) return false;
    const role = "role" in entry && typeof entry.role === "string" ? entry.role.trim() : "";
    const assignee =
      "assignee" in entry && typeof entry.assignee === "string" ? entry.assignee.trim() : "";
    return Boolean(role || assignee);
  }).length;
}

/** True when the org authored any card field the briefing can show. */
export function hasAuthoredBriefingCard(input: {
  gamePlan?: string | null;
  autoAssignment?: string | null;
  defenseFocus?: string | null;
  keyThreats?: string | null;
  driverNotes?: string | null;
  roleAssignments?: unknown;
}): boolean {
  return Boolean(
    trimOrNull(input.gamePlan) ||
      trimOrNull(input.autoAssignment) ||
      trimOrNull(input.defenseFocus) ||
      trimOrNull(input.keyThreats) ||
      trimOrNull(input.driverNotes) ||
      usableRoleCount(input.roleAssignments) > 0,
  );
}

export type BriefingCardCueInput = {
  gamePlan?: string | null;
  autoAssignment?: string | null;
  defenseFocus?: string | null;
  keyThreats?: string | null;
  driverNotes?: string | null;
  roleAssignments?: unknown;
  /** Real TBA alliance partners. Omitted / empty → no auto-coordination cue. */
  partnerNumbers?: number[];
};

/**
 * Cue triple from authored card text — the briefing counterpart of briefingCuesFromText.
 *
 * Empty card → `{ auto, backup, deploy }` all null, even when TBA partners exist.
 * Backup still fires from a written Auto that never names a backup path (no partners required).
 * Auto coordination stays partner-gated so we never invent an alliance.
 */
export function briefingCardCuesFromAuthored(input: BriefingCardCueInput): BriefingCardCues {
  if (!hasAuthoredBriefingCard(input)) {
    return { ...EMPTY_BRIEFING_CARD_CUES };
  }

  const partners = (input.partnerNumbers ?? []).filter((n) => Number.isFinite(n) && n > 0);
  const autoAssignment = trimOrNull(input.autoAssignment);
  // Same detectors as toBriefingMatchCardPayload. A sentinel partner unlocks the
  // written-auto backup check when the briefing caller has no TBA lineup; auto
  // coordination is forced back to null unless real partners were passed.
  const cues = briefingCuesFromText({
    partnerNumbers: partners.length > 0 ? partners : autoAssignment ? [1] : [],
    autoAssignment,
    gamePlan: input.gamePlan,
    driverNotes: input.driverNotes,
  });
  return {
    auto: partners.length > 0 ? cues.auto : null,
    backup: cues.backup,
    deploy: cues.deploy,
  };
}
