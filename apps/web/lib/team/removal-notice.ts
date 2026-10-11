/** What /api/onboarding/removal returns (core's TeamRemovalNotice). */
export type TeamRemoval = { orgId: string; team: string; removedBy: string | null; removedAt: string };

/**
 * The no-team screen's line for someone taken off a team (QA A3-15): which team, who, when,
 * that the account is still theirs, and what to do if it was a mistake.
 */
export function removalNoticeCopy(
  removal: TeamRemoval,
  formatDate: (date: Date) => string = (date) => date.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
): { title: string; body: string } {
  const when = new Date(removal.removedAt);
  const on = Number.isFinite(when.getTime()) ? ` on ${formatDate(when)}` : "";
  const by = removal.removedBy?.trim();
  return {
    title: `You were removed from ${removal.team}`,
    body:
      `${by ? `${by} took you off the team` : "A team lead took you off the team"}${on}. ` +
      "Your Vantage account and profile are still yours. If this was a mistake, ask the team's owner to invite you again.",
  };
}

export function isTeamRemoval(value: unknown): value is TeamRemoval {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.orgId === "string" && typeof row.team === "string" && typeof row.removedAt === "string";
}
