/**
 * Live scout ↔ official match cross-validation helpers.
 * Reads only cached TBA score breakdowns / Statbotics metrics — never invents values.
 */

export type ComparableFieldKind = "climb" | "mobility" | "foul" | "other";

export type OfficialFieldPolicy = {
  fieldKey: string;
  officialKey?: string | null;
  teamIndexed?: boolean;
};

export type AllianceSide = {
  teamKeys?: string[];
  score?: number | null;
};

export type MatchOfficialSnapshot = {
  matchKey: string;
  redAlliance: AllianceSide;
  blueAlliance: AllianceSide;
  scoreBreakdown: Record<string, unknown> | null;
};

export type TbaTeamMatchFacts = {
  alliance: "red" | "blue";
  teamIndex: 1 | 2 | 3;
  climb: unknown | null;
  climbKey: string | null;
  mobility: unknown | null;
  mobilityKey: string | null;
  foulCount: number | null;
  techFoulCount: number | null;
  foulPoints: number | null;
  foulKey: string | null;
};

export type StatboticsEndgameSignal = {
  epaEndgame: number | null;
  source: "statbotics";
  softNote: string | null;
};

const compact = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

export function classifyComparableField(fieldKey: string): ComparableFieldKind {
  const field = compact(fieldKey);
  if (field.includes("climb") || field.includes("endgame") || field.includes("hang")) return "climb";
  if (field.includes("mobility") || field.includes("taxi") || field.includes("autoline") || field.includes("leave")) {
    return "mobility";
  }
  if (field.includes("foul") || field.includes("penalty") || field.includes("card")) return "foul";
  return "other";
}

function allianceOfTeam(
  teamKey: string,
  red: AllianceSide,
  blue: AllianceSide,
): { alliance: "red" | "blue"; teamIndex: 1 | 2 | 3 } | null {
  const redTeams = red.teamKeys ?? [];
  const blueTeams = blue.teamKeys ?? [];
  if (redTeams.includes(teamKey)) {
    const index = redTeams.indexOf(teamKey) + 1;
    if (index < 1 || index > 3) return null;
    return { alliance: "red", teamIndex: index as 1 | 2 | 3 };
  }
  if (blueTeams.includes(teamKey)) {
    const index = blueTeams.indexOf(teamKey) + 1;
    if (index < 1 || index > 3) return null;
    return { alliance: "blue", teamIndex: index as 1 | 2 | 3 };
  }
  return null;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function readAllianceNumber(record: Record<string, unknown>, keys: string[]): { value: number | null; key: string | null } {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    const value = asFiniteNumber(record[key]);
    if (value != null) return { value, key };
  }
  return { value: null, key: null };
}

function readRobotValue(
  record: Record<string, unknown>,
  teamIndex: 1 | 2 | 3,
  prefixes: string[],
): { value: unknown | null; key: string | null } {
  for (const prefix of prefixes) {
    const key = `${prefix}${teamIndex}`;
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      return { value: record[key], key };
    }
  }
  return { value: null, key: null };
}

/** Extract climb / mobility / foul facts for one team from a cached TBA match. */
export function extractTbaTeamMatchFacts(
  match: MatchOfficialSnapshot,
  teamKey: string,
): TbaTeamMatchFacts | null {
  if (!match.scoreBreakdown) return null;
  const seat = allianceOfTeam(teamKey, match.redAlliance, match.blueAlliance);
  if (!seat) return null;
  const side = match.scoreBreakdown[seat.alliance];
  if (!side || typeof side !== "object") return null;
  const record = side as Record<string, unknown>;
  const climb = readRobotValue(record, seat.teamIndex, ["endGameRobot", "endgameRobot", "endGame"]);
  const mobility = readRobotValue(record, seat.teamIndex, [
    "mobilityRobot",
    "autoLineRobot",
    "taxiRobot",
    "autoLeaveRobot",
  ]);
  const fouls = readAllianceNumber(record, ["foulCount", "fouls", "foul"]);
  const tech = readAllianceNumber(record, ["techFoulCount", "techFouls"]);
  const foulPoints = readAllianceNumber(record, ["foulPoints", "foulPoint"]);
  return {
    alliance: seat.alliance,
    teamIndex: seat.teamIndex,
    climb: climb.value,
    climbKey: climb.key,
    mobility: mobility.value,
    mobilityKey: mobility.key,
    foulCount: fouls.value,
    techFoulCount: tech.value,
    foulPoints: foulPoints.value,
    foulKey: fouls.key ?? tech.key ?? foulPoints.key,
  };
}

/** Resolve the official value (+ TBA key) for a scout field against cached match facts. */
export function officialValueFromTbaFacts(input: {
  fieldKey: string;
  policy?: OfficialFieldPolicy;
  facts: TbaTeamMatchFacts;
  scoreBreakdown: Record<string, unknown>;
}): { value: unknown; officialKey: string; kind: ComparableFieldKind } | null {
  const kind = classifyComparableField(input.fieldKey);
  const configured = input.policy?.officialKey?.trim();
  if (configured) {
    const alliance = input.facts.alliance;
    const side = input.scoreBreakdown[alliance];
    if (!side || typeof side !== "object") return null;
    const record = side as Record<string, unknown>;
    const key = input.policy?.teamIndexed
      ? configured.replace("{n}", String(input.facts.teamIndex))
      : configured;
    if (!Object.prototype.hasOwnProperty.call(record, key)) return null;
    return { value: record[key], officialKey: key, kind };
  }
  if (kind === "climb" && input.facts.climbKey) {
    return { value: input.facts.climb, officialKey: input.facts.climbKey, kind };
  }
  if (kind === "mobility" && input.facts.mobilityKey) {
    return { value: input.facts.mobility, officialKey: input.facts.mobilityKey, kind };
  }
  if (kind === "foul" && input.facts.foulKey) {
    const field = compact(input.fieldKey);
    const value = field.includes("tech")
      ? input.facts.techFoulCount
      : field.includes("point")
        ? input.facts.foulPoints
        : (input.facts.foulCount ?? input.facts.foulPoints ?? input.facts.techFoulCount);
    if (value == null) return null;
    return { value, officialKey: input.facts.foulKey, kind };
  }
  return null;
}

/**
 * Soft Statbotics signal only — never a hard contradiction by itself.
 * Uses cached EPA endgame when present; returns null when metrics are missing.
 */
export function softStatboticsClimbSignal(input: {
  scoutClimb: unknown;
  epaEndgame: number | null | undefined;
}): StatboticsEndgameSignal | null {
  if (input.epaEndgame == null || !Number.isFinite(input.epaEndgame)) return null;
  const climb = compact(input.scoutClimb);
  const noneLike = !climb || ["none", "no", "0", "false", "park", "parked", "failed"].includes(climb);
  const strongLike = ["high", "traversal", "deep", "full", "stage", "harmony", "trap"].includes(climb);
  let softNote: string | null = null;
  if (noneLike && input.epaEndgame >= 8) {
    softNote = `Scout climb looks empty while Statbotics event EPA endgame is ${input.epaEndgame.toFixed(1)}.`;
  } else if (strongLike && input.epaEndgame <= 1.5) {
    softNote = `Scout climb looks strong while Statbotics event EPA endgame is only ${input.epaEndgame.toFixed(1)}.`;
  }
  return { epaEndgame: input.epaEndgame, source: "statbotics", softNote };
}

export function isComparableScoutField(fieldKey: string): boolean {
  return classifyComparableField(fieldKey) !== "other";
}
