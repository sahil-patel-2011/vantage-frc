// Pure, unit-testable helpers for Match Strategy Cards. No I/O, no framework imports.

import type { AllianceColor, MatchStrategyAlliance, MatchStrategyCard } from "./types";

export const COMP_LEVEL_LABEL: Record<string, string> = {
  qm: "Qualification",
  ef: "Octofinal",
  qf: "Quarterfinal",
  sf: "Semifinal",
  f: "Final",
};

export function compLevelLabel(compLevel: string): string {
  return COMP_LEVEL_LABEL[compLevel] ?? compLevel;
}

export function matchLabel(card: Pick<MatchStrategyCard, "compLevel" | "matchNumber" | "setNumber">): string {
  const base = compLevelLabel(card.compLevel);
  if (card.compLevel === "qm") return `${base} ${card.matchNumber}`;
  return `${base} ${card.setNumber}-${card.matchNumber}`;
}

/** Extracts frcNNNN team keys from a matches_ref alliance jsonb column into sorted team numbers. */
export function teamNumbersFromAllianceJson(value: unknown): number[] {
  if (!value || typeof value !== "object") return [];
  const teamKeys = (value as { team_keys?: unknown; teamKeys?: unknown }).team_keys
    ?? (value as { teamKeys?: unknown }).teamKeys;
  if (!Array.isArray(teamKeys)) return [];
  return teamKeys
    .filter((key): key is string => typeof key === "string")
    .map((key) => Number(key.replace(/^frc/i, "")))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
}

export function resolveOwnAllianceColor(
  alliances: MatchStrategyAlliance[],
): AllianceColor | null {
  return alliances.find((a) => a.isOwnAlliance)?.color ?? null;
}

export function alliancePartners(alliances: MatchStrategyAlliance[], ownTeamNumber: number): number[] {
  const own = alliances.find((a) => a.isOwnAlliance);
  if (!own) return [];
  return own.teamNumbers.filter((n) => n !== ownTeamNumber);
}

export function opponentTeams(alliances: MatchStrategyAlliance[]): number[] {
  return alliances.filter((a) => !a.isOwnAlliance).flatMap((a) => a.teamNumbers);
}

/** True once the drive team has authored any content for this card. */
export function cardHasContent(card: Pick<
  MatchStrategyCard,
  "gamePlan" | "autoAssignment" | "defenseFocus" | "keyThreats" | "driverNotes" | "roleAssignments"
>): boolean {
  return Boolean(
    (card.gamePlan && card.gamePlan.trim()) ||
      (card.autoAssignment && card.autoAssignment.trim()) ||
      (card.defenseFocus && card.defenseFocus.trim()) ||
      (card.keyThreats && card.keyThreats.trim()) ||
      (card.driverNotes && card.driverNotes.trim()) ||
      card.roleAssignments.length > 0,
  );
}

/** Plain-text render of a card suitable for printing / clipboard copy. */
export function renderCardText(card: MatchStrategyCard): string {
  const lines: string[] = [];
  lines.push(matchLabel(card));
  for (const alliance of card.alliances) {
    const tag = alliance.isOwnAlliance ? `${alliance.color.toUpperCase()} (us)` : alliance.color.toUpperCase();
    lines.push(`${tag}: ${alliance.teamNumbers.map((n) => `${n}`).join(", ") || "TBD"}`);
  }
  if (card.gamePlan) lines.push(`Game plan: ${card.gamePlan}`);
  if (card.autoAssignment) lines.push(`Auto: ${card.autoAssignment}`);
  if (card.defenseFocus) lines.push(`Defense focus: ${card.defenseFocus}`);
  if (card.keyThreats) lines.push(`Key threats: ${card.keyThreats}`);
  if (card.driverNotes) lines.push(`Driver notes: ${card.driverNotes}`);
  if (card.roleAssignments.length) {
    lines.push(`Roles: ${card.roleAssignments.map((r) => `${r.role} — ${r.assignee}`).join("; ")}`);
  }
  return lines.join("\n");
}
