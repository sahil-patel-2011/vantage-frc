/**
 * Team-6925-only deep FRC game-guess loop.
 *
 * Runs on the Pi (Freebuff Coder UI), not on Vercel. One job thinks continuously
 * for five hours — no hourly schedule. Guesses must cite fetched sources or stay
 * empty — never invent official rules or DEMO scoring.
 */

export const DEEP_GAME_ANALYSIS_TEAM_NUMBER = 6925;
export const DEEP_GAME_ANALYSIS_KIND = "deep_game_analysis" as const;
export const DEEP_GAME_ANALYSIS_FEATURE = "deep_game_analysis";

export const DEFAULT_MIN_LOOPS = 1;
export const DEFAULT_MIN_HOURS = 5;
export const DEFAULT_LOOP_INTERVAL_MS = 0;
export const DEFAULT_LOOP_MIN_MS = 0;
export const DEFAULT_TURN_PACE_MS = 0;

export type DeepGameSourceKind =
  | "official"
  | "historical"
  | "teaser"
  | "theme"
  | "speculation"
  | "community";

export type DeepGameSourceSeed = {
  url: string;
  title: string;
  kind: DeepGameSourceKind;
};

/** Official names/years only. Mechanics stay one-line public facts, never invented scores. */
export type HistoricalFrcGame = {
  year: number;
  officialName: string;
  publicFact: string;
};

export type DeepGameGuess = {
  themeGuess: string | null;
  fieldGuess: string | null;
  scoringGuess: string[];
  rulesGuess: string[];
  robotImplications: string[];
  unknowns: string[];
  evidenceUrls: string[];
  speculation: string[];
  confidence: "none" | "low" | "medium" | "high";
  disclaimer: string;
};

export type DeepGameTurn = {
  focus: string;
  notes: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
};

export type DeepAnalysisClock = {
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
};

export const EMPTY_GUESS_DISCLAIMER =
  "Guess stays empty until fetched FIRST/community text supports it. Speculation is labeled. This is not the official manual.";

export function isDeepGameAnalysisTeam(teamNumber: number | null | undefined): boolean {
  return Number(teamNumber) === DEEP_GAME_ANALYSIS_TEAM_NUMBER;
}

export function emptyGuess(): DeepGameGuess {
  return {
    themeGuess: null,
    fieldGuess: null,
    scoringGuess: [],
    rulesGuess: [],
    robotImplications: [],
    unknowns: ["No fetched teaser or official text yet — cannot guess rules."],
    evidenceUrls: [],
    speculation: [],
    confidence: "none",
    disclaimer: EMPTY_GUESS_DISCLAIMER,
  };
}

export const HISTORICAL_FRC_GAMES: readonly HistoricalFrcGame[] = [
  { year: 2016, officialName: "FIRST Stronghold", publicFact: "Castle defenses and a high/low goal boulder game." },
  { year: 2017, officialName: "FIRST STEAMWORKS", publicFact: "Fuel (balls) plus gears delivered to an airship." },
  { year: 2018, officialName: "FIRST POWER UP", publicFact: "Power cubes on a scale/switch plus a vault." },
  { year: 2019, officialName: "Destination: Deep Space", publicFact: "Hatch panels and cargo on a rocket/cargo ship." },
  { year: 2020, officialName: "Infinite Recharge", publicFact: "Power cells into a power port plus a generator switch climb." },
  { year: 2021, officialName: "Infinite Recharge (2021)", publicFact: "Same Infinite Recharge game, at-home / 2021 season format." },
  { year: 2022, officialName: "Rapid React", publicFact: "Cargo into a hub plus hangar climb." },
  { year: 2023, officialName: "CHARGED UP", publicFact: "Cubes/cones on a grid plus a charging-station balance." },
  { year: 2024, officialName: "CRESCENDO", publicFact: "Notes into a speaker/amp plus a chain climb / trap." },
  { year: 2025, officialName: "REEFSCAPE", publicFact: "Coral on a reef plus algae and a barge climb." },
  { year: 2026, officialName: "REBUILT", publicFact: "Published 2026 season name in Vantage's game-year pack; fetch FIRST pages for mechanics." },
];

export const ANALYSIS_TURN_FOCUSES = [
  "inventory_and_missing_sources",
  "historical_game_comparison",
  "teaser_and_theme_decode",
  "scoring_and_rules_guess",
  "field_and_gamepiece_guess",
  "robot_implications",
  "speculation_vs_evidence_audit",
  "synthesis_and_unknowns",
] as const;

export function seedSourcesForSeason(seasonYear: number): DeepGameSourceSeed[] {
  const year = Number.isInteger(seasonYear) ? seasonYear : new Date().getUTCFullYear();
  return [
    {
      url: "https://www.firstinspires.org/robotics/frc",
      title: "FIRST Robotics Competition home",
      kind: "official",
    },
    {
      url: "https://www.firstinspires.org/robotics/frc/kickoff",
      title: "FRC Kickoff",
      kind: "official",
    },
    {
      url: "https://www.firstinspires.org/robotics/frc/game-and-season",
      title: "FRC game and season",
      kind: "official",
    },
    {
      url: "https://www.firstinspires.org/robotics/frc/blog",
      title: "FRC blog (teasers / theme posts)",
      kind: "teaser",
    },
    {
      url: `https://www.thebluealliance.com/events/${year}`,
      title: `The Blue Alliance ${year} events`,
      kind: "historical",
    },
    {
      url: `https://www.thebluealliance.com/events/${year - 1}`,
      title: `The Blue Alliance ${year - 1} events (prior season)`,
      kind: "historical",
    },
    {
      url: "https://www.chiefdelphi.com/c/first-programs/frc/6",
      title: "Chief Delphi FRC forum",
      kind: "community",
    },
    {
      url: "https://www.chiefdelphi.com/search?q=teaser%20game%20reveal",
      title: "Chief Delphi teaser / reveal search",
      kind: "speculation",
    },
    {
      url: "https://www.youtube.com/@FIRSTRoboticsCompetition",
      title: "FIRST Robotics Competition YouTube",
      kind: "theme",
    },
  ];
}

export function shouldContinueDeepAnalysis(input: {
  startedAt: Date | string | null;
  loopCount?: number;
  now?: Date;
  minHours?: number;
  minLoops?: number;
  cancelled?: boolean;
}): boolean {
  if (input.cancelled) return false;
  if (!input.startedAt) return true;
  const started = input.startedAt instanceof Date ? input.startedAt : new Date(input.startedAt);
  if (Number.isNaN(started.getTime())) return true;
  const now = input.now ?? new Date();
  const minHours = input.minHours ?? DEFAULT_MIN_HOURS;
  return now.getTime() - started.getTime() < minHours * 60 * 60 * 1000;
}

export function nextLoopScheduledFor(input: {
  loopStartedAt: Date;
  now?: Date;
  intervalMs?: number;
}): Date {
  const intervalMs = input.intervalMs ?? DEFAULT_LOOP_INTERVAL_MS;
  const due = new Date(input.loopStartedAt.getTime() + intervalMs);
  const now = input.now ?? new Date();
  return due.getTime() > now.getTime() ? due : new Date(now.getTime() + intervalMs);
}

export function loopStillOpen(input: {
  loopStartedAt: Date;
  now?: Date;
  minLoopMs?: number;
}): boolean {
  const minLoopMs = input.minLoopMs ?? DEFAULT_LOOP_MIN_MS;
  const now = input.now ?? new Date();
  return now.getTime() - input.loopStartedAt.getTime() < minLoopMs;
}

export function parseDeepGameGuess(raw: string, evidenceUrls: string[]): DeepGameGuess {
  const fallback = emptyGuess();
  fallback.evidenceUrls = [...new Set(evidenceUrls.filter(Boolean))];
  const trimmed = raw.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return fallback;
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
    const urls = uniqueStrings([
      ...asStringArray(parsed.evidenceUrls),
      ...evidenceUrls,
    ]).slice(0, 40);
    const scoring = asStringArray(parsed.scoringGuess);
    const rules = asStringArray(parsed.rulesGuess);
    const hasBody =
      Boolean(asNullableString(parsed.themeGuess) || asNullableString(parsed.fieldGuess)) ||
      scoring.length > 0 ||
      rules.length > 0;
    if (!hasBody || urls.length === 0) {
      return {
        ...fallback,
        evidenceUrls: urls,
        unknowns: asStringArray(parsed.unknowns).length
          ? asStringArray(parsed.unknowns)
          : fallback.unknowns,
        speculation: asStringArray(parsed.speculation),
      };
    }
    const confidence = asConfidence(parsed.confidence);
    return {
      themeGuess: asNullableString(parsed.themeGuess),
      fieldGuess: asNullableString(parsed.fieldGuess),
      scoringGuess: scoring,
      rulesGuess: rules,
      robotImplications: asStringArray(parsed.robotImplications),
      unknowns: asStringArray(parsed.unknowns),
      evidenceUrls: urls,
      speculation: asStringArray(parsed.speculation),
      confidence: confidence === "high" && urls.length < 2 ? "medium" : confidence,
      disclaimer: EMPTY_GUESS_DISCLAIMER,
    };
  } catch {
    return fallback;
  }
}

export function historicalGamesPromptBlock(priorYear: number): string {
  const rows = HISTORICAL_FRC_GAMES.filter((game) => game.year <= priorYear)
    .map((game) => `- ${game.year} ${game.officialName}: ${game.publicFact}`)
    .join("\n");
  return `Known official past FRC games (public names only — do not invent scores):\n${rows}`;
}

export function buildLoopTurnPrompt(input: {
  seasonYear: number;
  focus: string;
  loopSequence: number;
  sources: Array<{ url: string; title: string; kind: string; excerpt: string; fetchOk: boolean }>;
  previousGuess: DeepGameGuess | null;
  packHint?: { gameName: string; seasonTheme: string; status: string };
}): string {
  const fetched = input.sources.filter((source) => source.fetchOk && source.excerpt.trim());
  const failed = input.sources.filter((source) => !source.fetchOk);
  const excerpts = fetched
    .slice(0, 12)
    .map(
      (source) =>
        `SOURCE ${source.kind} ${source.url}\nTitle: ${source.title}\n${source.excerpt.slice(0, 1800)}`,
    )
    .join("\n\n---\n\n");
  const pack = input.packHint
    ? `Vantage pack hint (not a manual): ${input.packHint.gameName} / ${input.packHint.seasonTheme} (${input.packHint.status}). Scoring keys in the pack are empty until FIRST publishes the manual.`
    : "No local game pack hint.";
  return [
    `You are Vantage's slow FRC game-analysis agent for team ${DEEP_GAME_ANALYSIS_TEAM_NUMBER} only.`,
    `Season under study: ${input.seasonYear}. This is loop ${input.loopSequence}, focus: ${input.focus}.`,
    "Work slowly. Compare teasers, theme videos, community speculation, and past official games.",
    "Never invent DEMO metrics, match results, or official rule numbers that were not in the fetched text.",
    "If evidence is thin, leave guesses null/empty and list unknowns. Label speculation separately.",
    pack,
    historicalGamesPromptBlock(input.seasonYear - 1),
    input.previousGuess
      ? `Previous best guess JSON:\n${JSON.stringify(input.previousGuess)}`
      : "No previous guess.",
    failed.length
      ? `Unfetched (do not treat as evidence): ${failed.map((source) => source.url).join(", ")}`
      : "All seeded URLs returned text.",
    excerpts || "(no fetched excerpts — return an empty guess with unknowns)",
    "Return JSON only:",
    '{"themeGuess":string|null,"fieldGuess":string|null,"scoringGuess":string[],"rulesGuess":string[],"robotImplications":string[],"unknowns":string[],"evidenceUrls":string[],"speculation":string[],"confidence":"none"|"low"|"medium"|"high"}',
  ].join("\n\n");
}

export function readDeepAnalysisPacing(env: NodeJS.ProcessEnv = process.env): {
  minHours: number;
  minLoops: number;
  intervalMs: number;
  minLoopMs: number;
  turnPaceMs: number;
} {
  const minHours = positiveInt(env.DEEP_GAME_ANALYSIS_MIN_HOURS, DEFAULT_MIN_HOURS);
  const minLoops = positiveInt(env.DEEP_GAME_ANALYSIS_MIN_LOOPS, DEFAULT_MIN_LOOPS);
  const intervalMs = positiveInt(env.DEEP_GAME_ANALYSIS_INTERVAL_MS, DEFAULT_LOOP_INTERVAL_MS);
  const minLoopMs = positiveInt(env.DEEP_GAME_ANALYSIS_LOOP_MIN_MS, DEFAULT_LOOP_MIN_MS);
  const turnPaceMs = positiveInt(env.DEEP_GAME_ANALYSIS_PACE_MS, DEFAULT_TURN_PACE_MS);
  return { minHours, minLoops, intervalMs, minLoopMs, turnPaceMs };
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function asNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed.slice(0, 800) : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(
    value.filter((item): item is string => typeof item === "string").map((item) => item.trim()),
  ).slice(0, 24);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((item) => item.length >= 3 && item.length <= 500))];
}

function asConfidence(value: unknown): DeepGameGuess["confidence"] {
  return value === "low" || value === "medium" || value === "high" || value === "none"
    ? value
    : "none";
}
