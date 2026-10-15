import { FIELD_CENTRIC_FIELDS, withFieldCentric } from "./field-centric";
import { BIOCORE_2027 } from "./packs/biocore-2027";
import { REBUILT_2026 } from "./packs/rebuilt-2026";
import { REEFSCAPE_2025 } from "./packs/reefscape-2025";
import type { GameYearPack, SchemaDefinition } from "./types";

export type {
  GameField,
  GameFieldType,
  GameSchema,
  GameYearBrief,
  GameYearPack,
  GameYearStatus,
  SchemaDefinition,
} from "./types";
export { BIOCORE_2027, FIELD_CENTRIC_FIELDS, REBUILT_2026, withFieldCentric };

const PACKS: Record<number, GameYearPack> = {
  2025: REEFSCAPE_2025,
  2026: REBUILT_2026,
  2027: BIOCORE_2027,
};

/**
 * The one season every record belongs to: the calendar year. An FRC season is named for the
 * year it competes in and kickoff is in January, so the calendar year is right without a
 * rollover month to argue about — and it is the year The Blue Alliance puts on fall
 * off-season events. Every season picker and default uses this; do not add a local copy.
 */
export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

/**
 * The next game to prepare for. From August the following year's game is the one teams
 * plan around, so the public game brief looks ahead. Not a records season: pickers and
 * defaults use {@link currentSeasonYear}.
 */
export function upcomingGameYear(now: Date = new Date()): number {
  return now.getUTCMonth() >= 7 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
}

/** Same recent seasons across workspaces, plus every year with saved work. */
export function availableSeasonYears(saved: readonly number[] = [], now: Date = new Date()): number[] {
  const current = currentSeasonYear(now);
  return [...new Set([current, current - 1, current - 2, ...saved.filter(year => Number.isInteger(year) && year >= 1992 && year <= 2100)])].sort((a, b) => b - a);
}

/**
 * Which season a records page opens on when nobody picked one: this season, unless it has
 * nothing yet and an earlier season does — then the latest season with records, so a page
 * never opens empty in January while last season's work sits one click away.
 */
export function openingSeasonYear(savedYears: readonly number[], now: Date = new Date()): number {
  const current = currentSeasonYear(now);
  if (savedYears.includes(current)) return current;
  const earlier = savedYears.filter(year => year < current).sort((a, b) => b - a);
  return earlier[0] ?? current;
}

export function packForYear(year: number): GameYearPack {
  return PACKS[year] ?? fallbackPack(year);
}

function fallbackPack(year: number): GameYearPack {
  return {
    year,
    gameName: `FRC ${year}`,
    seasonTheme: "",
    status: "awaiting_manual",
    scoringKeys: [],
    matchSchema: {
      title: `${year} match scouting`,
      fields: withFieldCentric([
        { key: "auto_score", label: "Auto score", type: "number" },
        { key: "teleop_score", label: "Teleop score", type: "number" },
        {
          key: "endgame",
          label: "Endgame",
          type: "select",
          options: ["none", "partial", "full"],
        },
        { key: "disabled", label: "Disabled", type: "boolean" },
        { key: "notes", label: "Notes", type: "text" },
      ]),
    },
    pitSchema: {
      title: `${year} pit scouting`,
      fields: [
        {
          key: "drivetrain_type",
          label: "Drivetrain",
          type: "drivetrain_type",
          options: ["swerve", "west_coast", "tank", "mecanum", "other"],
        },
        {
          key: "programming_language",
          label: "Programming language",
          type: "select",
          options: ["java", "c++", "python", "labview", "other"],
        },
        { key: "driver_seasons", label: "Driver seasons of experience", type: "number" },
        { key: "robot_images", label: "Robot images", type: "robot_image" },
        { key: "notes", label: "Notes", type: "text" },
      ],
    },
    strategyTemplates: [],
  };
}

export function defaultMatchSchema(year: number): SchemaDefinition {
  return packForYear(year).matchSchema;
}

export function defaultPitSchema(year: number): SchemaDefinition {
  return packForYear(year).pitSchema;
}

export function isManualPublished(year: number): boolean {
  return packForYear(year).status === "published";
}

/** Newest published pack at or before `year`, if any. */
export function lastPublishedPack(year: number = currentSeasonYear()): GameYearPack | null {
  const known = Object.keys(PACKS)
    .map(Number)
    .filter((candidate) => candidate <= year)
    .sort((a, b) => b - a);
  for (const candidate of known) {
    const pack = PACKS[candidate];
    if (pack && pack.status === "published") return pack;
  }
  return null;
}
