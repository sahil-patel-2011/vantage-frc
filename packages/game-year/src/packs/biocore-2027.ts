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
      {
        key: "auto_score",
        label: "Auto score (official, if known)",
        type: "number",
        helpText:
          "Official auto points you can see this match. Leave blank if the manual is not out yet — do not guess a game-specific breakdown.",
        helps: ["pick_list"],
      },
      {
        key: "teleop_score",
        label: "Teleop score (official, if known)",
        type: "number",
        helpText:
          "Official teleop points this robot contributed this match. Leave blank rather than inventing a scoring mode.",
        helps: ["pick_list"],
      },
      {
        key: "endgame",
        label: "Endgame",
        type: "select",
        options: ["none", "partial", "full"],
        helpText:
          "What they completed at the end of this match. Use none if they never tried. Helps pick list once the manual names the action.",
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
        helpText:
          "Only what the other questions missed. Keep it short. Do not write claimed BIOCORE scoring before the manual.",
        helps: ["pick_list", "alliance", "repair"],
        widget: "free",
      },
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
        helpText:
          "Observable pit facts the other questions miss. Do not invent BIOCORE metrics before the manual.",
        helps: ["repair", "pick_list", "pit"],
        widget: "free",
      },
    ],
  },
  strategyTemplates: [],
};
