import { FIELD_CENTRIC_FIELDS, withFieldCentric } from "./field-centric";
import { BIOCORE_2027 } from "./packs/biocore-2027";
import { REBUILT_2026 } from "./packs/rebuilt-2026";
import type { GameYearPack, SchemaDefinition } from "./types";

export type {
  GameField,
  GameFieldType,
  GameSchema,
  GameYearBrief,
  GameYearPack,
  GameYearStatus,
  SchemaDefinition,
  ScoutFieldUse,
} from "./types";
export {
  formatScoutFieldHelp,
  isScoutFieldUse,
  normalizeScoutFieldUses,
  SCOUT_FIELD_USE_LABELS,
  SCOUT_FIELD_USES,
} from "./scout-intent";
export { BIOCORE_2027, FIELD_CENTRIC_FIELDS, REBUILT_2026, withFieldCentric };

const PACKS: Record<number, GameYearPack> = {
  2026: REBUILT_2026,
  2027: BIOCORE_2027,
};

export function currentSeasonYear(now: Date = new Date()): number {
  const month = now.getUTCMonth();
  const year = now.getUTCFullYear();
  // FRC season year is the kickoff calendar year. August starts next-season planning.
  return month >= 7 ? year + 1 : year;
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
        {
          key: "auto_score",
          label: "Auto score",
          type: "number",
          helpText: "Official auto points this robot scored this match. Leave blank if you could not see it.",
          helps: ["pick_list"],
        },
        {
          key: "teleop_score",
          label: "Teleop score",
          type: "number",
          helpText: "Official teleop points this robot scored this match. Do not invent a game-specific breakdown.",
          helps: ["pick_list"],
        },
        {
          key: "endgame",
          label: "Endgame",
          type: "select",
          options: ["none", "partial", "full"],
          helpText: "What they completed at the end of this match. Use none if they never tried.",
          helps: ["pick_list", "alliance"],
        },
        {
          key: "disabled",
          label: "Disabled",
          type: "boolean",
          helpText: "Robot was dead, e-stopped, or fully out for a stretch of this match.",
          helps: ["pick_list", "repair"],
        },
        {
          key: "notes",
          label: "Notes",
          type: "text",
          helpText: "Only what the other questions missed. Keep it short and specific.",
          helps: ["pick_list", "alliance", "repair"],
          widget: "free",
        },
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
          helpText: "What drive they built. Pushing matches and spare-parts planning.",
          helps: ["pick_list", "alliance", "repair"],
        },
        {
          key: "programming_language",
          label: "Programming language",
          type: "select",
          options: ["java", "c++", "python", "labview", "other"],
          helpText: "Language on the robot so you can help debug in the pit.",
          helps: ["repair"],
        },
        {
          key: "driver_seasons",
          label: "Driver seasons of experience",
          type: "number",
          helpText: "How many seasons this driver has driven. How much partners should coach in-match.",
          helps: ["alliance"],
        },
        {
          key: "robot_images",
          label: "Robot images",
          type: "robot_image",
          helpText: "Front and side pit photos — the useful pit artifact for pick list and repair.",
          helps: ["pick_list", "pit", "repair"],
        },
        {
          key: "notes",
          label: "Notes",
          type: "text",
          helpText: "Observable pit facts the other questions miss.",
          helps: ["repair", "pick_list", "pit"],
          widget: "free",
        },
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
