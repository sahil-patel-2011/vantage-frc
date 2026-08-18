import { FIELD_CENTRIC_FIELDS, withFieldCentric } from "./field-centric";
import { BIOCORE_2027 } from "./packs/biocore-2027";
import { REBUILT_2026 } from "./packs/rebuilt-2026";
import type { GameYearPack, SchemaDefinition } from "./types";

export type { GameField, GameFieldType, GameSchema, GameYearPack, GameYearStatus, SchemaDefinition } from "./types";
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
