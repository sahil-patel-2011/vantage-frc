export type IntelMatchResult = "win" | "loss" | "tie" | "unplayed";
export type IntelAllianceColor = "red" | "blue";

export type IntelTeamMatch = {
  matchKey: string;
  eventKey: string;
  eventName: string | null;
  year: number;
  compLevel: string;
  setNumber: number;
  matchNumber: number;
  alliance: IntelAllianceColor;
  partners: number[];
  opponents: number[];
  ourScore: number | null;
  theirScore: number | null;
  result: IntelMatchResult;
  playedAt: string | null;
};

export type IntelEventStanding = {
  eventKey: string;
  eventName: string | null;
  year: number;
  rank: number | null;
  wins: number | null;
  losses: number | null;
  ties: number | null;
  rating: number | null;
};

export function allianceTeamKeys(alliance: unknown): string[] {
  if (!alliance || typeof alliance !== "object") return [];
  const raw =
    (alliance as { teamKeys?: unknown; team_keys?: unknown }).teamKeys ??
    (alliance as { team_keys?: unknown }).team_keys;
  if (!Array.isArray(raw)) return [];
  return raw.filter((key): key is string => typeof key === "string");
}

export function allianceScore(alliance: unknown): number | null {
  if (!alliance || typeof alliance !== "object") return null;
  const raw = (alliance as { score?: unknown }).score;
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function teamNumberFromKey(teamKey: string): number | null {
  const match = /^frc(\d+)$/i.exec(teamKey.trim());
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function numbersFromKeys(keys: string[], except?: number): number[] {
  const out: number[] = [];
  for (const key of keys) {
    const n = teamNumberFromKey(key);
    if (n == null || n === except) continue;
    out.push(n);
  }
  return out;
}

export function matchResultForAlliance(
  alliance: IntelAllianceColor,
  winningAlliance: string | null,
  ourScore: number | null,
  theirScore: number | null,
): IntelMatchResult {
  const winner = (winningAlliance ?? "").trim().toLowerCase();
  if (winner === "red" || winner === "blue") {
    return winner === alliance ? "win" : "loss";
  }
  if (winner === "tie") return "tie";
  if (ourScore != null && theirScore != null) {
    if (ourScore > theirScore) return "win";
    if (ourScore < theirScore) return "loss";
    return "tie";
  }
  return "unplayed";
}

export function buildIntelTeamMatch(input: {
  teamKey: string;
  matchKey: string;
  eventKey: string;
  eventName: string | null;
  year: number;
  compLevel: string;
  setNumber: number;
  matchNumber: number;
  redAlliance: unknown;
  blueAlliance: unknown;
  winningAlliance: string | null;
  playedAt: string | Date | null;
}): IntelTeamMatch | null {
  const redKeys = allianceTeamKeys(input.redAlliance);
  const blueKeys = allianceTeamKeys(input.blueAlliance);
  const onRed = redKeys.includes(input.teamKey);
  const onBlue = blueKeys.includes(input.teamKey);
  if (onRed === onBlue) return null;
  const alliance: IntelAllianceColor = onRed ? "red" : "blue";
  const ownNumber = teamNumberFromKey(input.teamKey);
  const ourScore = allianceScore(onRed ? input.redAlliance : input.blueAlliance);
  const theirScore = allianceScore(onRed ? input.blueAlliance : input.redAlliance);
  const playedAt =
    input.playedAt instanceof Date
      ? input.playedAt.toISOString()
      : typeof input.playedAt === "string" && input.playedAt.trim()
        ? input.playedAt
        : null;
  return {
    matchKey: input.matchKey,
    eventKey: input.eventKey,
    eventName: input.eventName,
    year: input.year,
    compLevel: input.compLevel,
    setNumber: input.setNumber,
    matchNumber: input.matchNumber,
    alliance,
    partners: numbersFromKeys(onRed ? redKeys : blueKeys, ownNumber ?? undefined),
    opponents: numbersFromKeys(onRed ? blueKeys : redKeys),
    ourScore,
    theirScore,
    result: matchResultForAlliance(alliance, input.winningAlliance, ourScore, theirScore),
    playedAt,
  };
}

export function sortEventStandings(rows: IntelEventStanding[]): IntelEventStanding[] {
  return [...rows].sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    return a.eventKey < b.eventKey ? 1 : a.eventKey > b.eventKey ? -1 : 0;
  });
}
