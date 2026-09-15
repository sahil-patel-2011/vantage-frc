import type { IntelEventStanding, IntelMatchResult, IntelTeamMatch } from "@vantage/intel-research";

export type IntelCompLevel = "qm" | "ef" | "qf" | "sf" | "f";

function isIntelCompLevel(value: string): value is IntelCompLevel {
  return value === "qm" || value === "ef" || value === "qf" || value === "sf" || value === "f";
}

export function intelCompLevelLabel(level: string): string {
  if (!isIntelCompLevel(level)) return "Match";
  switch (level) {
    case "qm":
      return "Qualification";
    case "ef":
      return "Octofinal";
    case "qf":
      return "Quarterfinal";
    case "sf":
      return "Semifinal";
    case "f":
      return "Final";
    default: {
      const exhaustive: never = level;
      return exhaustive;
    }
  }
}

export function intelMatchLabel(match: Pick<IntelTeamMatch, "compLevel" | "matchNumber" | "setNumber">): string {
  const base = intelCompLevelLabel(match.compLevel);
  if (match.compLevel === "qm") return `${base} ${match.matchNumber}`;
  return `${base} ${match.setNumber}-${match.matchNumber}`;
}

export function intelMatchResultLabel(result: IntelMatchResult): string {
  switch (result) {
    case "win":
      return "Win";
    case "loss":
      return "Loss";
    case "tie":
      return "Tie";
    case "unplayed":
      return "Not played";
    default: {
      const exhaustive: never = result;
      return exhaustive;
    }
  }
}

export function intelAllianceLabel(color: "red" | "blue"): string {
  switch (color) {
    case "red":
      return "Red";
    case "blue":
      return "Blue";
    default: {
      const exhaustive: never = color;
      return exhaustive;
    }
  }
}

export function intelRecordLine(
  wins: number | null | undefined,
  losses: number | null | undefined,
  ties: number | null | undefined,
): string | null {
  if (wins == null && losses == null && ties == null) return null;
  const w = wins ?? 0;
  const l = losses ?? 0;
  const t = ties ?? 0;
  return t > 0 ? `${w}–${l}–${t}` : `${w}–${l}`;
}

export function intelRankLine(rank: number | null | undefined): string | null {
  if (rank == null || !Number.isInteger(rank) || rank < 1) return null;
  return `Rank ${rank}`;
}

export function intelCurrentStanding(
  events: IntelEventStanding[],
  activeEventKey: string | null | undefined,
): IntelEventStanding | null {
  if (activeEventKey) {
    const active = events.find((event) => event.eventKey === activeEventKey);
    if (active) return active;
  }
  return events[0] ?? null;
}

export function intelLastPlayedMatch(matches: IntelTeamMatch[]): IntelTeamMatch | null {
  return matches.find((match) => match.result !== "unplayed") ?? matches[0] ?? null;
}

export function intelScoreLine(match: Pick<IntelTeamMatch, "ourScore" | "theirScore">): string {
  if (match.ourScore == null || match.theirScore == null) return "—";
  return `${match.ourScore}–${match.theirScore}`;
}

export function intelPartnerLine(partners: number[]): string | null {
  if (!partners.length) return null;
  return partners.join(" · ");
}
