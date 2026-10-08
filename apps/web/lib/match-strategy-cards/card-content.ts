import type { MatchStrategyCard, MatchStrategyRoleAssignment } from "./types";

export type CardContent = Pick<MatchStrategyCard, "gamePlan" | "autoAssignment" | "defenseFocus" | "keyThreats" | "driverNotes" | "roleAssignments">;
export type CardMutation = { matchKey: string; eventKey: string; baseRevision: string | null } &
  ({ action: "save-card" } & CardContent | { action: "delete-card" });

/** Match the API's normalization when comparing a draft with a saved response. */
export function normalizeCardContent(content: CardContent): CardContent {
  const text = (value: string | null, max: number) => value?.trim().slice(0, max) || null;
  return {
    gamePlan: text(content.gamePlan, 4000), autoAssignment: text(content.autoAssignment, 2000),
    defenseFocus: text(content.defenseFocus, 2000), keyThreats: text(content.keyThreats, 2000),
    driverNotes: text(content.driverNotes, 4000),
    roleAssignments: content.roleAssignments.map((row): MatchStrategyRoleAssignment => ({ role: row.role.trim().slice(0, 80), assignee: row.assignee.trim().slice(0, 80) }))
      .filter(row => row.role || row.assignee).slice(0, 20),
  };
}

export function sameCardContent(a: CardContent, b: CardContent): boolean {
  return JSON.stringify(normalizeCardContent(a)) === JSON.stringify(normalizeCardContent(b));
}

export const EMPTY_CARD_CONTENT: CardContent = {
  gamePlan: null, autoAssignment: null, defenseFocus: null, keyThreats: null, driverNotes: null, roleAssignments: [],
};
