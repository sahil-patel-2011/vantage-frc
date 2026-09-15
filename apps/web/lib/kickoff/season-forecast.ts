import { computeGameBrief } from "../game-brief/compute-game-brief";
import {
  KICKOFF_ADVICE_LABEL,
  type DesignDirection,
  type GameIntelligenceSummary,
  type GamePiece,
  type KickoffAnalysisMode,
} from "../kickoff-intelligence";

export const DEEP_KICKOFF_TEAM_NUMBER = 6925;
export const KICKOFF_STANDARD_MODEL = "vantage-kickoff-standard-v1";

export type { KickoffAnalysisMode };

export type ForecastManual = {
  title: string;
  href: string;
  program: "frc" | "ftc";
};

export type LeakVsActualRow = {
  year: string;
  publicBeforeKickoff: string;
  whatShipped: string;
};

export type StandardSeasonForecast = {
  seasonYear: number;
  gameName: string;
  seasonTheme: string;
  status: "published" | "awaiting_manual";
  title: string;
  overview: string;
  manuals: ForecastManual[];
  leakVsActual: LeakVsActualRow[];
  leakLessons: string[];
  ftcCompare: string[];
  guess: string[];
  howToPlay: string[];
  openQuestions: string[];
  gamePieces: GamePiece[];
  designDirections: DesignDirection[];
  disclaimer: string;
};

const STANDARD_DISCLAIMER =
  "Best guess from official FIRST pages, last season's published game, and how public season branding compared with what actually shipped. Not a substitute for the official FRC manual.";

const FRC_SEASON_MATERIALS = "https://www.firstinspires.org/resources/library/frc/season-materials";
const FRC_ARCHIVED_GAMES = "https://www.firstinspires.org/resources/library/frc/archived-games";
const FRC_2026_MANUAL = "https://firstfrc.blob.core.windows.net/frc2026/Manual/2026GameManual.pdf";
const FTC_GAME_AND_SEASON = "https://www.firstinspires.org/programs/ftc/game-and-season";
const FTC_GAME_RESOURCES = "https://ftc-resources.firstinspires.org/ftc/game";
const FTC_BIOBUZZ_MANUAL = "https://ftc-resources.firstinspires.org/ftc/archive/2027/game/manual";

export function canRunDeepKickoffAnalysis(teamNumber: number | null | undefined): boolean {
  return teamNumber === DEEP_KICKOFF_TEAM_NUMBER;
}

export function analysisModeLabel(mode: KickoffAnalysisMode): string {
  switch (mode) {
    case "standard":
      return "Standard analysis";
    case "deep":
      return "Deep analysis";
    default: {
      const exhaustive: never = mode;
      return exhaustive;
    }
  }
}

export function intelligenceSourceLine(mode: KickoffAnalysisMode): string {
  switch (mode) {
    case "standard":
      return "From official FIRST pages and a labeled guess";
    case "deep":
      return "From your team's uploaded manual";
    default: {
      const exhaustive: never = mode;
      return exhaustive;
    }
  }
}

export function scoringEmptyLine(mode: KickoffAnalysisMode): string {
  switch (mode) {
    case "standard":
      return "Scores stay blank until the official FRC manual is out.";
    case "deep":
      return "No numeric scoring lines found — add them below.";
    default: {
      const exhaustive: never = mode;
      return exhaustive;
    }
  }
}

export function kickoffIntelligenceEmptyMessage(canDeepAnalyze: boolean): string {
  return canDeepAnalyze
    ? "Run standard analysis for a sourced season guess, or paste the manual for Team 6925 deep analysis."
    : "Run standard analysis to compare official manuals, how past public leaks lined up with the real FRC game, and this year's FTC game, then save a best guess until the FRC manual is out.";
}

export function deepAnalysisForbiddenMessage(): string {
  return "Deep analysis is only for Team 6925. Run standard analysis for a sourced season guess.";
}

export function intelligenceAnalysisMode(summary: GameIntelligenceSummary): KickoffAnalysisMode {
  return summary.provenance.analysisMode === "standard" ? "standard" : "deep";
}

function advice(capability: string, rationale: string, weight: number): DesignDirection {
  return {
    capability: capability.slice(0, 160),
    rationale: rationale.slice(0, 500),
    weight,
    adviceLabel: KICKOFF_ADVICE_LABEL,
  };
}

function officialManuals(): ForecastManual[] {
  return [
    {
      title: "FRC season materials (current English manual and team updates)",
      href: FRC_SEASON_MATERIALS,
      program: "frc",
    },
    {
      title: "FRC archived game documentation (past manuals and field packs)",
      href: FRC_ARCHIVED_GAMES,
      program: "frc",
    },
    {
      title: "2026 REBUILT game manual (PDF)",
      href: FRC_2026_MANUAL,
      program: "frc",
    },
    {
      title: "FTC game and season — BIOBUZZ presented by RTX",
      href: FTC_GAME_AND_SEASON,
      program: "ftc",
    },
    {
      title: "FTC game resources (manuals and team updates)",
      href: FTC_GAME_RESOURCES,
      program: "ftc",
    },
    {
      title: "2026–27 BIOBUZZ competition manual",
      href: FTC_BIOBUZZ_MANUAL,
      program: "ftc",
    },
  ];
}

function leakVsActualRows(): LeakVsActualRow[] {
  return [
    {
      year: "2025",
      publicBeforeKickoff:
        "FTC 2024–25 INTO THE DEEP was already public (ocean theme). Season branding traveled farther than any rumor score sheet.",
      whatShipped:
        "FRC shipped REEFSCAPE with coral and algae. Same world family as the FTC reveal, brand-new FRC scoring and field.",
    },
    {
      year: "2026",
      publicBeforeKickoff:
        "Public chatter guessed point tables and mechanisms months early. Theme names were the only part that kept showing up on official FIRST pages.",
      whatShipped:
        "FRC shipped REBUILT (fuel, obstacles, tower climb). The published manual is the record; rumor scores from before kickoff are retired.",
    },
    {
      year: "2026–27",
      publicBeforeKickoff:
        "FIRST announced CANOPY. FTC revealed BIOBUZZ presented by RTX on September 12, 2026, with a public manual. FRC published the name BIOCORE.",
      whatShipped:
        "FTC BIOBUZZ scoring and field are official. FRC BIOCORE kickoff is January 9, 2027 — FRC scoring and field are not published yet.",
    },
  ];
}

function leakLessons(): string[] {
  return [
    "Theme names and season branding land on official FIRST pages months before FRC kickoff. Those pages are announcements, not shop drawings.",
    "After kickoff, the published FRC manual is the record. Rumor point tables from past years did not become the scoring table.",
    "The FTC game in the same school year is the closest official preview of the season family. It is not a copy of FRC scoring.",
    "Game-piece families sometimes follow the theme (reef and coral, rebuild and fuel, bio and canopy). Mechanisms and point values do not travel with the name.",
  ];
}

function ftcCompare(seasonYear: number, gameName: string, seasonTheme: string): string[] {
  const shared: string[] = [
    "FTC 2026–27 is BIOBUZZ presented by RTX, part of FIRST CANOPY. FIRST published it on September 12, 2026, with a public competition manual.",
    "FRC 2027 is BIOCORE under FIRST CANOPY. Kickoff is January 9, 2027. The FRC scoring table is not out.",
    "Shared official facts: the CANOPY season family and the bio naming (BIOBUZZ / BIOCORE). Shared mechanisms or point values are not published for FRC.",
  ];
  if (seasonYear === 2026) {
    return [
      "FRC 2026 REBUILT is published (fuel, obstacles, tower). Use that manual for scoring, not a guess.",
      "FTC 2025–26 DECODE was the prior FTC challenge. It did not copy REBUILT scoring.",
      ...shared,
    ];
  }
  if (seasonYear !== 2027) {
    return [
      `${seasonYear} ${gameName}${seasonTheme ? ` (${seasonTheme})` : ""} is the FRC name on file. Compare it with the FTC manual from the same school year, not with rumor scores.`,
      ...shared,
    ];
  }
  return shared;
}

function guessFor(input: {
  seasonYear: number;
  gameName: string;
  seasonTheme: string;
  status: "published" | "awaiting_manual";
  priorGameName: string | null;
  priorYear: number | null;
}): string[] {
  if (input.status === "published") {
    return [
      `${input.seasonYear} ${input.gameName} already has a published FRC manual. Read that scoring table instead of a pre-kickoff guess.`,
      "Keep the leak-vs-actual notes as a study habit for next year: theme names held; rumor scores did not.",
    ];
  }
  const prior =
    input.priorYear && input.priorGameName
      ? `${input.priorYear} ${input.priorGameName}`
      : "last published season";
  return [
    `Official, not a guess: the ${input.seasonYear} FRC game is ${input.gameName}${input.seasonTheme ? `, season ${input.seasonTheme}` : ""}. Kickoff is January 9, 2027.`,
    "Official sibling: FTC BIOBUZZ is already public and talks about energy and the natural world. Use that as season-family context, not as an FRC point table.",
    `Best guess: ${input.gameName} stays in the CANOPY / living-systems family rather than bringing back ${prior} fuel and tower scoring.`,
    "Best guess: expect a new game-piece family and a new field. Practice notes and design talks on the last published season until the FRC manual posts.",
    "Leave scores blank. A guess that invents point values is just another rumor sheet.",
  ];
}

export function buildStandardSeasonForecast(seasonYear: number): StandardSeasonForecast {
  const brief = computeGameBrief(seasonYear);
  const status = brief.status === "published" ? "published" : "awaiting_manual";
  const guess = guessFor({
    seasonYear: brief.year,
    gameName: brief.gameName,
    seasonTheme: brief.seasonTheme,
    status,
    priorGameName: brief.priorSeason?.gameName ?? null,
    priorYear: brief.priorSeason?.year ?? null,
  });
  const lessons = leakLessons();
  const compare = ftcCompare(brief.year, brief.gameName, brief.seasonTheme);
  const title =
    status === "published"
      ? `${brief.year} ${brief.gameName} standard analysis`
      : `${brief.year} ${brief.gameName} season guess`;

  const overview =
    status === "published"
      ? `${brief.year} ${brief.gameName} has a published FRC manual. This standard pass still collects official links, how past public leaks compared with what shipped, and the FTC game from the same school year so the team can study the method.`
      : `${brief.year} ${brief.gameName} is official FIRST branding, but the FRC scoring table is not out. This standard pass collected official manuals, compared how past public leaks lined up with the real FRC game, compared FTC BIOBUZZ with FRC ${brief.gameName}, and wrote a labeled best guess.`;

  const gamePieces: GamePiece[] =
    status === "published"
      ? []
      : [
          {
            name: "Not in the FRC manual yet",
            notes: "FTC BIOBUZZ already names its own pieces. Do not copy those names into FRC scoring until FIRST publishes them for BIOCORE.",
          },
        ];

  const designDirections: DesignDirection[] =
    status === "published"
      ? [
          advice(
            "Read the published FRC manual end to end",
            `${brief.year} ${brief.gameName} scoring is official. Enter actions from that manual, not from a pre-kickoff guess.`,
            5,
          ),
          advice(
            "Keep the leak-vs-actual habit",
            "Theme names held in recent years. Rumor scores did not. File that before next fall's chatter starts.",
            3,
          ),
        ]
      : [
          advice(
            "Practice on last season until kickoff morning",
            brief.priorSeason
              ? `${brief.priorSeason.year} ${brief.priorSeason.gameName} has a published table. Use it for notes and design talks. ${brief.gameName} scores are not out.`
              : "Use the last published FRC game for notes and design talks until the new manual posts.",
            5,
          ),
          advice(
            "Read the FTC BIOBUZZ manual as season-family context",
            "BIOBUZZ is official and already public. Treat it as theme context, not FRC scoring.",
            4,
          ),
          advice(
            "Assign who opens the FRC manual on kickoff morning",
            "This guess is retired the morning the official FRC manual posts.",
            4,
          ),
        ];

  return {
    seasonYear: brief.year,
    gameName: brief.gameName,
    seasonTheme: brief.seasonTheme,
    status,
    title,
    overview,
    manuals: officialManuals(),
    leakVsActual: leakVsActualRows(),
    leakLessons: lessons,
    ftcCompare: compare,
    guess,
    howToPlay: [...compare, ...guess],
    openQuestions: [...brief.designQuestions],
    gamePieces,
    designDirections,
    disclaimer: STANDARD_DISCLAIMER,
  };
}

export function forecastToIntelligenceSummary(forecast: StandardSeasonForecast): GameIntelligenceSummary {
  return {
    gameName: forecast.gameName,
    seasonYear: forecast.seasonYear,
    overview: forecast.overview,
    gamePieces: forecast.gamePieces,
    fieldElements: [],
    scoring: [],
    howToPlay: forecast.howToPlay,
    constraints: forecast.leakLessons,
    openQuestions: forecast.openQuestions,
    designDirections: forecast.designDirections,
    forecast: {
      manuals: forecast.manuals,
      leakVsActual: forecast.leakVsActual,
      leakLessons: forecast.leakLessons,
      ftcCompare: forecast.ftcCompare,
      guess: forecast.guess,
    },
    provenance: {
      provider: "local",
      model: KICKOFF_STANDARD_MODEL,
      sourceKinds: ["published"],
      analysisMode: "standard",
      adviceLabel: KICKOFF_ADVICE_LABEL,
      disclaimer: forecast.disclaimer,
    },
  };
}
