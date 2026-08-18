import { withFieldCentric } from "../field-centric";
import type { GameYearPack } from "../types";

/** 2026 REBUILT — published manual. Keys match community scouting practice, not invented metrics. */
export const REBUILT_2026: GameYearPack = {
  year: 2026,
  gameName: "REBUILT",
  seasonTheme: "FIRST CANOPY precursor / REBUILT",
  status: "published",
  scoringKeys: [
    "auto_fuel",
    "teleop_fuel",
    "fuel_passed",
    "tower_level",
    "trench",
    "bump",
    "disabled",
  ],
  matchSchema: {
    title: "2026 REBUILT match",
    fields: withFieldCentric([
      { key: "auto_fuel", label: "Auto fuel scored", type: "number", required: true },
      { key: "teleop_fuel", label: "Teleop fuel scored", type: "number", required: true },
      { key: "fuel_passed", label: "Fuel passed", type: "number" },
      {
        key: "tower_level",
        label: "Tower climb",
        type: "select",
        options: ["none", "L1", "L2", "L3"],
      },
      { key: "trench", label: "Trench capable this match", type: "boolean" },
      { key: "bump", label: "Bump traversal this match", type: "boolean" },
      { key: "disabled", label: "Disabled", type: "boolean" },
      { key: "notes", label: "Notes", type: "text" },
    ]),
  },
  pitSchema: {
    title: "2026 REBUILT pit",
    fields: [
      {
        key: "drivetrain_type",
        label: "Drivetrain",
        type: "drivetrain_type",
        options: ["swerve", "west_coast", "tank", "mecanum", "other"],
        helpText: "Will you lose pushing matches? Observable in the pit.",
      },
      {
        key: "drive_motors",
        label: "Drivetrain motors",
        type: "text",
        helpText: "Type and count so alliance partners know if they can loan a spare.",
      },
      {
        key: "programming_language",
        label: "Programming language",
        type: "select",
        options: ["java", "c++", "python", "labview", "other"],
        helpText: "So you can help them troubleshoot — not a scoring claim.",
      },
      {
        key: "driver_seasons",
        label: "Driver seasons of experience",
        type: "number",
        helpText: "How hands-on should partners be in the match?",
      },
      {
        key: "coach_seasons",
        label: "Coach seasons of experience",
        type: "number",
      },
      {
        key: "robot_images",
        label: "Robot images",
        type: "robot_image",
        helpText: "Front and side pit photos — CD teams treat photos as the useful pit artifact.",
      },
      {
        key: "trench",
        label: "Goes under trench",
        type: "boolean",
        helpText: "Physical clearance — confirm in the pit, do not take a scoring claim.",
      },
      {
        key: "bump",
        label: "Goes over bump",
        type: "boolean",
      },
      { key: "notes", label: "Notes", type: "text" },
    ],
  },
  strategyTemplates: ["safe_fuel", "balanced", "climb_first"],
};
