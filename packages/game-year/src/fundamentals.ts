/**
 * FRC match/season fundamentals for Cursor skills and the `frc.fundamentals` agent tool.
 *
 * Summaries only — never copy FIRST Game Manual text. Scoring keys come from the
 * published `packages/game-year` pack for that year, or stay empty until a manual exists.
 */

import { currentSeasonYear, lastPublishedPack, packForYear } from "./registry";
import type { GameYearStatus } from "./types";

export type FrcOfficialSource = {
  id: string;
  title: string;
  url: string;
  why: string;
};

/** FIRST / WPILib pages only. Same hosts the agent may fetch. */
export const FRC_OFFICIAL_SOURCES: readonly FrcOfficialSource[] = [
  {
    id: "what-is-frc",
    title: "FIRST Robotics Competition",
    url: "https://www.firstinspires.org/robotics/frc",
    why: "FIRST's own overview of FRC.",
  },
  {
    id: "game-manual",
    title: "FRC Game Manual & Q&A",
    url: "https://www.firstinspires.org/resource-library/frc/competition-manual-qa-system",
    why: "The Game Manual, Team Updates, and official Q&A — the only authority on scoring and legality.",
  },
  {
    id: "kickoff",
    title: "FRC Kickoff",
    url: "https://www.firstinspires.org/robotics/frc/kickoff",
    why: "Where FIRST publishes the season reveal and kickoff materials.",
  },
  {
    id: "playing-field",
    title: "FRC Playing Field",
    url: "https://www.firstinspires.org/robotics/frc/playing-field",
    why: "Official field drawings — design to these, not a photo of a practice field.",
  },
  {
    id: "awards",
    title: "FRC Awards",
    url: "https://www.firstinspires.org/robotics/frc/awards",
    why: "Judged and individual honors for the current season.",
  },
  {
    id: "team-management",
    title: "FRC Team Management Resources",
    url: "https://www.firstinspires.org/robotics/frc/team-management-resources",
    why: "Registration, roster, and season-ops checklist from FIRST.",
  },
  {
    id: "wpilib",
    title: "WPILib documentation",
    url: "https://docs.wpilib.org/en/stable/",
    why: "Official robot-software docs for the current control system.",
  },
  {
    id: "wpilib-zero-to-robot",
    title: "WPILib Zero-to-Robot",
    url: "https://docs.wpilib.org/en/stable/docs/zero-to-robot/introduction.html",
    why: "Start here for installing WPILib and deploying code to a roboRIO.",
  },
] as const;

export type FrcVantageArea = "scouting" | "cad" | "code";

export type FrcVantageMapping = {
  area: FrcVantageArea;
  summary: string;
  routes: readonly string[];
  agentNotes: string;
};

export type FrcCurrentGame = {
  year: number;
  gameName: string;
  status: GameYearStatus;
  headline: string;
  whatWeKnow: readonly string[];
  scoutFirst: readonly string[];
  designQuestions: readonly string[];
  scoringKeys: readonly string[];
  scoringLabels: readonly string[];
  lastPublished: { year: number; gameName: string; status: GameYearStatus } | null;
};

export type FrcFundamentals = {
  seasonYear: number;
  disclaimer: string;
  whatIsFrc: { summary: string; sourceIds: readonly string[] };
  match: {
    summary: string;
    periods: readonly { name: string; summary: string }[];
    sourceIds: readonly string[];
  };
  season: { summary: string; sourceIds: readonly string[] };
  ranking: { summary: string; sourceIds: readonly string[] };
  awards: { summary: string; sourceIds: readonly string[] };
  currentGame: FrcCurrentGame;
  vantage: readonly FrcVantageMapping[];
  sources: readonly FrcOfficialSource[];
};

export const FRC_FUNDAMENTALS_DISCLAIMER =
  "High-level orientation only. Point values, timing, robot constraints, and award names for a given year live in that year's FIRST Game Manual, Team Updates, and Q&A — not here. Do not invent scores, ranking-point formulas, or demo metrics.";

const WHAT_IS_FRC =
  "FIRST Robotics Competition (FRC) is FIRST's high-school robotics program. Student teams design, build, and program a robot for a new game each season, then compete at events. Mentors coach; students do the work. FIRST publishes the rules. This is not a substitute for the Game Manual.";

const MATCH_SUMMARY =
  "A match is two alliances of three robots each (red vs blue). Drivers do not control the robot during autonomous. After that, the drive team plays teleop. An endgame window in the last seconds is scored per that year's manual (climb, park, or other tasks). Exact period lengths and points are only in the manual.";

const MATCH_PERIODS = [
  {
    name: "autonomous",
    summary: "The opening period. Pre-programmed routines run; drive team does not drive. Auto scoring is year-specific.",
  },
  {
    name: "teleop",
    summary: "Driver-controlled play for most of the match. Cycle scoring (game pieces, defense, etc.) is year-specific.",
  },
  {
    name: "endgame",
    summary:
      "The closing window of teleop. Typical tasks are climb, park, or trap — only the current manual names them and scores them.",
  },
] as const;

const SEASON_SUMMARY =
  "Kickoff in January reveals the game. Teams then have a short build window, compete at district or regional events, and may advance toward a championship. FIRST sets the real calendar each year — confirm dates on firstinspires.org, not from memory.";

const RANKING_SUMMARY =
  "Qualification matches seed the ranking. Ranking uses ranking points and published tiebreakers from that year's manual — do not invent RP values. After quals, alliance captains pick partners for playoffs. Playoff results decide the event winner; judged awards are separate.";

const AWARDS_SUMMARY =
  "FIRST publishes judged team awards (culture/impact, engineering inspiration, design and control) and individual honors (student Dean's List, mentor Woodie Flowers). Names and submission rules change; use the current awards page and Game Manual, not last year's list.";

const VANTAGE_MAPPING: readonly FrcVantageMapping[] = [
  {
    area: "scouting",
    summary:
      "Match and pit forms follow the published game-year pack. Pit notes stay drivetrain, language, driver seasons, and photos — not claimed scoring. Empty when the team has no scout rows.",
    routes: ["/scouting", "/scouting/forms", "/competition?tab=scouting"],
    agentNotes:
      "Use scouting.team / scouting.schema for org rows. Use this fundamentals object for which keys exist this year. Never fill missing scout numbers.",
  },
  {
    area: "cad",
    summary:
      "Build › CAD holds vault links, briefs, and Onshape/Fusion connectors. Cursor/Claude Code drive CAD through vantage-cad MCP plus the cad-onshape / cad-fusion skills — not by pasting geometry into product chat.",
    routes: ["/build?tab=cad", "/cad-vault", "/cad-learn"],
    agentNotes:
      "Load .agents/skills/cad-onshape or cad-fusion. Propose CAD; do not push Onshape without an explicit confirm. Not certified engineering.",
  },
  {
    area: "code",
    summary:
      "Build › Code is the robot-software surface: GitHub link, Bugbot, and WPILib-oriented review. Ground APIs in current WPILib docs, not training-data memories of last year's libraries.",
    routes: ["/build?tab=code", "/dev-setup", "/learn"],
    agentNotes:
      "Link https://docs.wpilib.org/en/stable/. Do not invent vendor APIs. CAD and code changes wait for a person.",
  },
];

function scoringLabelsFor(year: number): string[] {
  const pack = packForYear(year);
  return pack.matchSchema.fields
    .filter((field) => pack.scoringKeys.includes(field.key))
    .map((field) => field.label);
}

function currentGameFor(year: number): FrcCurrentGame {
  const pack = packForYear(year);
  const prior = lastPublishedPack(year);
  const lastPublished =
    prior && prior.year !== pack.year
      ? { year: prior.year, gameName: prior.gameName, status: prior.status }
      : pack.status === "published"
        ? { year: pack.year, gameName: pack.gameName, status: pack.status }
        : null;
  const brief = pack.status === "published" && pack.brief ? pack.brief : null;
  return {
    year: pack.year,
    gameName: pack.gameName,
    status: pack.status,
    headline:
      brief?.headline ??
      `${pack.gameName} — official scoring is not published yet. Do not invent a scoring table.`,
    whatWeKnow: brief?.whatWeKnow ?? [
      `The ${pack.year} Game Manual scoring table is not in Vantage's pack yet.`,
      "Until FIRST publishes it, keep match notes to official numbers only and pit notes to observable facts.",
    ],
    scoutFirst: brief?.scoutFirst ?? [
      "Keep pit notes to drivetrain, language, driver seasons, and photos.",
      "Record auto/teleop/endgame only when those numbers are official.",
    ],
    designQuestions: brief?.designQuestions ?? [
      "What from the last published season still trains the shop before kickoff?",
      "Who owns reading the manual the morning it posts?",
    ],
    scoringKeys: pack.scoringKeys,
    scoringLabels: scoringLabelsFor(pack.year),
    lastPublished,
  };
}

/** Structured FRC orientation + the game-year pack for `year` (default: calendar FRC season). */
export function frcFundamentals(year: number = currentSeasonYear()): FrcFundamentals {
  const seasonYear = Number.isInteger(year) ? year : currentSeasonYear();
  return {
    seasonYear,
    disclaimer: FRC_FUNDAMENTALS_DISCLAIMER,
    whatIsFrc: { summary: WHAT_IS_FRC, sourceIds: ["what-is-frc"] },
    match: {
      summary: MATCH_SUMMARY,
      periods: MATCH_PERIODS,
      sourceIds: ["game-manual", "playing-field"],
    },
    season: { summary: SEASON_SUMMARY, sourceIds: ["kickoff", "team-management"] },
    ranking: { summary: RANKING_SUMMARY, sourceIds: ["game-manual"] },
    awards: { summary: AWARDS_SUMMARY, sourceIds: ["awards"] },
    currentGame: currentGameFor(seasonYear),
    vantage: VANTAGE_MAPPING,
    sources: FRC_OFFICIAL_SOURCES,
  };
}
