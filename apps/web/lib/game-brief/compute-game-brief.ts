import {
  currentSeasonYear,
  lastPublishedPack,
  packForYear,
  type GameYearBrief,
  type GameYearPack,
  type GameYearStatus,
} from "@vantage/game-year";

export type GameBriefView = {
  year: number;
  gameName: string;
  seasonTheme: string;
  status: GameYearStatus;
  headline: string;
  whatWeKnow: readonly string[];
  scoutFirst: readonly string[];
  designQuestions: readonly string[];
  scoringLabels: readonly string[];
  strategyTemplates: readonly string[];
  priorSeason: {
    year: number;
    gameName: string;
    brief: GameYearBrief;
  } | null;
};

function scoringLabelsFor(pack: GameYearPack): string[] {
  return pack.matchSchema.fields
    .filter((field) => pack.scoringKeys.includes(field.key))
    .map((field) => field.label);
}

function emptyBrief(pack: GameYearPack): GameYearBrief {
  return {
    headline: `${pack.gameName} — official scoring is not published yet`,
    whatWeKnow: [
      pack.year === 2027
        ? "Kickoff is January 9, 2027. Use last season to practice scouting and design talks until the manual is out."
        : `The ${pack.year} scoring table is not in the manual yet.`,
    ],
    scoutFirst: [
      "Keep pit notes to drivetrain, language, driver seasons, and photos.",
      "Match notes can record auto score, teleop score, and endgame only when those numbers are official.",
    ],
    designQuestions: [
      "What from last season still trains the shop before kickoff?",
      "Who owns reading the manual the morning it posts?",
    ],
  };
}

export function computeGameBrief(year: number = currentSeasonYear()): GameBriefView {
  const pack = packForYear(year);
  const brief = pack.status === "published" && pack.brief ? pack.brief : emptyBrief(pack);
  const prior = lastPublishedPack(year);
  const priorSeason =
    pack.status === "awaiting_manual" && prior && prior.year !== pack.year && prior.brief
      ? { year: prior.year, gameName: prior.gameName, brief: prior.brief }
      : null;

  return {
    year: pack.year,
    gameName: pack.gameName,
    seasonTheme: pack.seasonTheme,
    status: pack.status,
    headline: brief.headline,
    whatWeKnow: brief.whatWeKnow,
    scoutFirst: brief.scoutFirst,
    designQuestions: brief.designQuestions,
    scoringLabels: scoringLabelsFor(pack),
    strategyTemplates: pack.strategyTemplates,
    priorSeason,
  };
}

/** Prefills Ask AI from Kickoff. Only published-pack facts; blanks stay blank. */
export function gameAskPrompt(year: number): string {
  const brief = computeGameBrief(year);
  const lines = [
    `Help us plan ${brief.gameName} ${brief.year}.`,
    brief.headline,
    ...brief.whatWeKnow,
  ];
  if (brief.priorSeason) {
    lines.push(
      `Last season we can study now: ${brief.priorSeason.gameName} ${brief.priorSeason.year}. ${brief.priorSeason.brief.headline}`,
      ...brief.priorSeason.brief.whatWeKnow,
    );
  }
  lines.push("If a scoring rule is not published yet, say so. Do not fill in missing numbers.");
  return lines.join("\n");
}

export function gameAskHref(orgId: string, year: number): string {
  const params = new URLSearchParams({
    orgId,
    prompt: gameAskPrompt(year),
    source: "kickoff",
  });
  return `/chat?${params.toString()}`;
}

/** Badge on the Kickoff brief — awaiting a manual is not a Vantage setup gap. */
export function gameBriefStatusBadge(status: GameYearStatus): string {
  switch (status) {
    case "published":
      return "From the manual";
    case "awaiting_manual":
      return "Manual not out";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}
