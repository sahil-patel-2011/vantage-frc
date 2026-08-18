import { withFieldCentric } from "../field-centric";
import type { GameYearPack } from "../types";

/**
 * 2027 BIOCORE — kickoff Jan 9 2027. Scoring keys stay empty until the manual
 * is published. Generic collection fields only; never invent BIOCORE metrics.
 */
export const BIOCORE_2027: GameYearPack = {
  year: 2027,
  gameName: "BIOCORE",
  seasonTheme: "FIRST CANOPY",
  status: "awaiting_manual",
  scoringKeys: [],
  matchSchema: {
    title: "2027 BIOCORE match (awaiting manual)",
    fields: withFieldCentric([
      { key: "auto_score", label: "Auto score (official, if known)", type: "number" },
      { key: "teleop_score", label: "Teleop score (official, if known)", type: "number" },
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
    title: "2027 BIOCORE pit (awaiting manual)",
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
