// Human-authored match strategy card on the ONE pre-match briefing.
//
// /match-strategy-cards writes match_strategy_cards (migration 0275) — the printable game plan
// for this match. The briefing reads that stored row; if the org has not authored one (or the
// row is whitespace-only), this returns null so the UI can show the honest "write a card" step
// instead of inventing a plan from TBA alliances.
//
// Cues (auto / backup / deploy) come from the same written fields as toBriefingMatchCardPayload.
// An empty card yields no cues.

import {
  briefingCardCuesFromAuthored,
  hasAuthoredBriefingCard,
  type BriefingCardCues,
} from "./card-cues";
import type { BriefingCard } from "./types";

export type { BriefingCardCues } from "./card-cues";

/** Row shape as read from match_strategy_cards (JSONB role_assignments arrive already parsed). */
export type MatchStrategyCardRow = {
  gamePlan: string | null;
  autoAssignment: string | null;
  defenseFocus: string | null;
  keyThreats: string | null;
  driverNotes: string | null;
  roleAssignments: unknown;
  updatedAt: string | null;
};

export type SelectBriefingCardOptions = {
  /** Real TBA alliance partners. Omitted → auto-coordination cue stays null. */
  partnerNumbers?: number[];
};

/** Authored card plus the cue triple match-strategy-cards already exports on briefingPayload. */
export type BriefingCardWithCues = BriefingCard & { cues: BriefingCardCues };

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function roleAssignmentsOf(value: unknown): BriefingCard["roleAssignments"] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is { role?: unknown; assignee?: unknown } => typeof entry === "object" && entry !== null)
    .map((entry) => ({
      role: typeof entry.role === "string" ? entry.role.trim() : "",
      assignee: typeof entry.assignee === "string" ? entry.assignee.trim() : "",
    }))
    .filter((entry) => entry.role || entry.assignee);
}

/**
 * Stored match card for this match, or null when nothing usable was authored.
 *
 * A row that exists but is all blanks is treated as empty — the briefing never fills those
 * fields from TBA lineup data, and never attaches cues.
 */
export function selectBriefingCard(
  row: MatchStrategyCardRow | null | undefined,
  options?: SelectBriefingCardOptions,
): BriefingCardWithCues | null {
  if (!row) return null;
  const roleAssignments = roleAssignmentsOf(row.roleAssignments);
  const card: BriefingCard = {
    gamePlan: trimOrNull(row.gamePlan),
    autoAssignment: trimOrNull(row.autoAssignment),
    defenseFocus: trimOrNull(row.defenseFocus),
    keyThreats: trimOrNull(row.keyThreats),
    driverNotes: trimOrNull(row.driverNotes),
    roleAssignments,
    updatedAt: row.updatedAt ?? null,
  };
  if (!hasAuthoredBriefingCard(card)) return null;
  return {
    ...card,
    cues: briefingCardCuesFromAuthored({
      ...card,
      partnerNumbers: options?.partnerNumbers,
    }),
  };
}
