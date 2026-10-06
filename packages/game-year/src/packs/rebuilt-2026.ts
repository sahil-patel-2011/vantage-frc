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
    "auto_tower_level",
    "tower_level",
  ],
  matchSchema: {
    title: "2026 REBUILT match",
    fields: withFieldCentric([
      { key: "auto_fuel", label: "Auto fuel scored", type: "number", config: { scoutPhase: "auto", requireObservation: true, min: 0, integer: true }, helpText: "Fuel observed entering the active hub. Leave blank if you could not count it; 0 means an observed zero." },
      { key: "auto_tower_level", label: "Autonomous tower climb", type: "select", options: ["none", "L1"], config: { scoutPhase: "auto" }, helpText: "Record the autonomous climb separately from the endgame climb." },
      { key: "teleop_fuel", label: "Teleop fuel scored", type: "number", config: { scoutPhase: "teleop", requireObservation: true, min: 0, integer: true }, helpText: "Only fuel entering an active hub scores. Released fuel from live bouts is a separate observation." },
      { key: "fuel_passed", label: "Fuel passed", type: "number", config: { scoutPhase: "teleop", requireObservation: true, min: 0, integer: true }, helpText: "Alliance support, not official scoring points. Leave blank if not counted." },
      {
        key: "tower_level",
        label: "Endgame tower climb",
        type: "select",
        options: ["none", "L1", "L2", "L3"],
        config: { scoutPhase: "endgame" },
      },
      { key: "trench", label: "Trench capable this match", type: "boolean" },
      { key: "bump", label: "Bump traversal this match", type: "boolean" },
      { key: "disabled", label: "Disabled", type: "boolean" },
      { key: "shooting_moving", label: "Shot while moving", type: "boolean", config: { scoutPhase: "review" } },
      { key: "shooting_accuracy", label: "Observed shooting accuracy", type: "select", options: ["mostly_hit", "mixed", "mostly_missed", "could_not_see"], config: { scoutPhase: "review" }, helpText: "An observation, not a calculated percentage." },
      { key: "defense_effectiveness", label: "Observed defense effectiveness", type: "select", options: ["did_not_defend", "effective", "mixed", "ineffective", "could_not_see"], config: { scoutPhase: "review" } },
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
  brief: {
    headline: "Fuel on the field, then a tower climb",
    whatWeKnow: [
      "Fuel scores only in an active hub. Passing fuel is alliance support, not a scoring category.",
      "Autonomous can score an L1 tower climb; teleop climbs score L1, L2, or L3 separately.",
      "Trench and bump are traversal facts you confirm in the pit and mark per match.",
    ],
    scoutFirst: [
      "Count observed scored fuel separately from released or passed fuel; leave an unseen count blank.",
      "Time shooting, feeding, defense, and downtime; enter released fuel per bout only when counted.",
      "Record autonomous and endgame tower climbs separately.",
      "Mark trench and bump only when that robot did them this match.",
      "In the pit: drivetrain, motors, language, driver seasons, photos, and clearance.",
    ],
    designQuestions: [
      "Do we score fuel in auto, pass it, or both?",
      "What tower level can we climb if a partner is dead?",
      "Do we fit the trench, clear the bump, or play the open field?",
    ],
  },
};
