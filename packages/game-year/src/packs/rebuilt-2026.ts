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
      },
      {
        key: "robot_images",
        label: "Robot images",
        type: "robot_image",
        helpText: "Pit photos of the robot.",
      },
      {
        key: "tower_capability",
        label: "Claimed tower level",
        type: "select",
        options: ["none", "L1", "L2", "L3"],
      },
      { key: "trench", label: "Goes under trench", type: "boolean" },
      { key: "bump", label: "Goes over bump", type: "boolean" },
      { key: "fuel_capacity", label: "Fuel capacity (claimed)", type: "number" },
      { key: "notes", label: "Notes", type: "text" },
    ],
  },
  strategyTemplates: ["safe_fuel", "balanced", "climb_first"],
};
