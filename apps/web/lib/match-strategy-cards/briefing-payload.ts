// Briefing-consumable export of a human-authored match strategy card.
//
// /briefing already reads match_strategy_cards rows. This payload is the same
// authored fields plus auto / backup / deploy cues derived only from that
// written text (and real TBA partners). Never invents a game plan, EPA, or
// win odds — empty text stays empty so briefing can render an honest gap.

import {
  alliancePartners,
  autoCoordinationCue,
  autoFlexibilityCue,
  cardHasContent,
  deploySafetyCue,
} from ".";
import type { MatchStrategyAlliance, MatchStrategyCard, MatchStrategyRoleAssignment } from "./types";

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function usableRoles(value: MatchStrategyRoleAssignment[] | undefined): MatchStrategyRoleAssignment[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => ({
      role: typeof entry.role === "string" ? entry.role.trim() : "",
      assignee: typeof entry.assignee === "string" ? entry.assignee.trim() : "",
    }))
    .filter((entry) => entry.role || entry.assignee);
}

/** Auto / backup / deploy cues — null when the written text already covers them. */
export type MatchStrategyBriefingCues = {
  auto: string | null;
  backup: string | null;
  deploy: string | null;
};

/**
 * Structurally compatible with BriefingCard plus the next-match key and cues.
 * Briefing can spread the authored fields and render cues independently.
 */
export type MatchStrategyBriefingPayload = {
  matchKey: string;
  hasCard: boolean;
  gamePlan: string | null;
  autoAssignment: string | null;
  defenseFocus: string | null;
  keyThreats: string | null;
  driverNotes: string | null;
  roleAssignments: MatchStrategyRoleAssignment[];
  updatedAt: string | null;
  cues: MatchStrategyBriefingCues;
};

export type BriefingPayloadInput = {
  matchKey: string;
  partnerNumbers: number[];
  gamePlan?: string | null;
  autoAssignment?: string | null;
  defenseFocus?: string | null;
  keyThreats?: string | null;
  driverNotes?: string | null;
  roleAssignments?: MatchStrategyRoleAssignment[];
  updatedAt?: string | null;
  hasCard?: boolean;
};

/** Cue triple from written Auto / game-plan / driver notes only. */
export function briefingCuesFromText(input: {
  partnerNumbers: number[];
  autoAssignment?: string | null;
  gamePlan?: string | null;
  driverNotes?: string | null;
}): MatchStrategyBriefingCues {
  const autoAssignment = trimOrNull(input.autoAssignment);
  const gamePlan = trimOrNull(input.gamePlan);
  const driverNotes = trimOrNull(input.driverNotes);
  return {
    auto: autoCoordinationCue({ partnerNumbers: input.partnerNumbers, autoAssignment }),
    backup: autoFlexibilityCue({ partnerNumbers: input.partnerNumbers, autoAssignment }),
    deploy: deploySafetyCue({ gamePlan, driverNotes }),
  };
}

/**
 * Export one card as a briefing-consumable payload.
 * Cues come from written text + real TBA partners — never DEMO strategy.
 */
export function toBriefingMatchCardPayload(input: BriefingPayloadInput): MatchStrategyBriefingPayload {
  const gamePlan = trimOrNull(input.gamePlan);
  const autoAssignment = trimOrNull(input.autoAssignment);
  const defenseFocus = trimOrNull(input.defenseFocus);
  const keyThreats = trimOrNull(input.keyThreats);
  const driverNotes = trimOrNull(input.driverNotes);
  const roleAssignments = usableRoles(input.roleAssignments);
  const authored = cardHasContent({
    gamePlan,
    autoAssignment,
    defenseFocus,
    keyThreats,
    driverNotes,
    roleAssignments,
  });
  return {
    matchKey: input.matchKey,
    hasCard: Boolean(input.hasCard) || authored,
    gamePlan,
    autoAssignment,
    defenseFocus,
    keyThreats,
    driverNotes,
    roleAssignments,
    updatedAt: input.updatedAt ?? null,
    cues: briefingCuesFromText({
      partnerNumbers: input.partnerNumbers,
      autoAssignment,
      gamePlan,
      driverNotes,
    }),
  };
}

export function briefingPayloadFromCard(
  card: Pick<
    MatchStrategyCard,
    | "matchKey"
    | "gamePlan"
    | "autoAssignment"
    | "defenseFocus"
    | "keyThreats"
    | "driverNotes"
    | "roleAssignments"
    | "updatedAt"
    | "hasCard"
    | "alliances"
  >,
  ownTeamNumber: number,
  alliances?: MatchStrategyAlliance[],
): MatchStrategyBriefingPayload {
  return toBriefingMatchCardPayload({
    matchKey: card.matchKey,
    partnerNumbers: alliancePartners(alliances ?? card.alliances, ownTeamNumber),
    gamePlan: card.gamePlan,
    autoAssignment: card.autoAssignment,
    defenseFocus: card.defenseFocus,
    keyThreats: card.keyThreats,
    driverNotes: card.driverNotes,
    roleAssignments: card.roleAssignments,
    updatedAt: card.updatedAt,
    hasCard: card.hasCard,
  });
}
