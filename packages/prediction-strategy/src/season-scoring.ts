/**
 * Which scoring pieces a season is allowed to predict.
 *
 * The 2026 breakdown (fuel and a tower) is not the 2027 game. BIOCORE's manual
 * is not out until kickoff on 9 January 2027, so that season has no category
 * list here. Callers predict a total only until a real list is added. Nothing
 * in this file is a guessed point value.
 */

export type ScoringCategoryId = "auto" | "teleop" | "endgame" | "foul";

export type SeasonScoring = {
  season: number;
  game: string;
  /** ISO date the manual is expected. Informational. */
  kickoff: string;
  /**
   * Additive pieces. auto + teleop + endgame + foul is the scoreboard total
   * when the breakdown supports that split. Empty when the manual is unknown.
   */
  categories: readonly ScoringCategoryId[];
  categoriesKnown: boolean;
  notes: string;
};

const REBUILT_2026: SeasonScoring = {
  season: 2026,
  game: "REBUILT",
  kickoff: "2026-01-10",
  categories: ["auto", "teleop", "endgame", "foul"],
  categoriesKnown: true,
  notes:
    "Auto, teleop fuel, endgame tower, and foul points. The Blue Alliance total teleop already includes the tower, so teleop in this split is teleop fuel only and the four pieces add up to the scoreboard.",
};

const BIOCORE_2027: SeasonScoring = {
  season: 2027,
  game: "BIOCORE",
  kickoff: "2027-01-09",
  categories: [],
  categoriesKnown: false,
  notes:
    "Kickoff is 9 January 2027. The scoring categories are not in a manual yet, so predictions stay a total until they are.",
};

export function scoringForSeason(season: number): SeasonScoring {
  const year = Number.isFinite(season) ? Math.trunc(season) : new Date().getUTCFullYear();
  if (year >= 2027) return { ...BIOCORE_2027, season: year };
  if (year === 2026) return REBUILT_2026;
  return {
    season: year,
    game: "unlisted",
    kickoff: "",
    categories: [],
    categoriesKnown: false,
    notes: "No category map is registered for this season, so only a match total can be predicted.",
  };
}

const AUTO_KEYS = ["autoPoints", "totalAutoPoints", "totalAuto"] as const;
const TELEOP_KEYS = ["teleopPoints", "totalTeleopPoints", "totalTeleop"] as const;
const TELEOP_FUEL_KEYS = ["teleopFuelPoints"] as const;
const ENDGAME_KEYS = [
  "endGameTowerPoints",
  "endgameTowerPoints",
  "totalTowerPoints",
  "endGameBargePoints",
  "endGameTotalStagePoints",
  "endgameTotalPoints",
  "endGamePoints",
  "endgamePoints",
] as const;
const FOUL_KEYS = ["foulPoints"] as const;

function firstNumber(record: Record<string, unknown> | null, keys: readonly string[]): number | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

const close = (left: number, right: number) => Math.abs(left - right) < 0.51;

export type AdditiveParts = {
  auto: number | null;
  /** Teleop fuel, or the raw teleop total when the breakdown does not say how the tower sits inside it. */
  teleop: number | null;
  endgame: number | null;
  foul: number | null;
  /** True when auto + teleop + endgame + foul matches the scoreboard. */
  additive: boolean;
};

/**
 * Split an official breakdown into pieces that add up to the scoreboard.
 *
 * 2025-style breakdowns already store teleop and endgame separately. 2026
 * stores a teleop total that includes the tower. The scoreboard decides which
 * one this row is. When neither identity holds, the raw numbers come back and
 * `additive` is false — the caller must not pretend they sum.
 */
export function additiveParts(
  score: number | null,
  breakdown: Record<string, unknown> | null,
): AdditiveParts {
  const auto = firstNumber(breakdown, AUTO_KEYS);
  const teleopRaw = firstNumber(breakdown, TELEOP_KEYS);
  const teleopFuel = firstNumber(breakdown, TELEOP_FUEL_KEYS);
  const endgame = firstNumber(breakdown, ENDGAME_KEYS);
  const foul = firstNumber(breakdown, FOUL_KEYS);
  const empty: AdditiveParts = { auto, teleop: teleopRaw, endgame, foul, additive: false };
  if (score == null || !Number.isFinite(score)) return empty;
  const foulValue = foul ?? 0;
  const robot = score - foulValue;

  if (
    auto != null &&
    teleopFuel != null &&
    endgame != null &&
    close(auto + teleopFuel + endgame + foulValue, score)
  ) {
    return { auto, teleop: teleopFuel, endgame, foul: foul ?? 0, additive: true };
  }
  if (auto != null && teleopRaw != null && endgame != null && close(auto + teleopRaw + endgame, robot)) {
    return { auto, teleop: teleopRaw, endgame, foul: foul ?? 0, additive: true };
  }
  if (
    auto != null &&
    teleopRaw != null &&
    endgame != null &&
    teleopRaw + 0.01 >= endgame &&
    close(auto + teleopRaw, robot)
  ) {
    return { auto, teleop: teleopRaw - endgame, endgame, foul: foul ?? 0, additive: true };
  }
  return empty;
}
