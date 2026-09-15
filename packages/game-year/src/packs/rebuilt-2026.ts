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
      {
        key: "starting_position",
        label: "Starting position",
        type: "select",
        options: ["trench", "bump", "hub"],
        helpText:
          "Where this robot was placed before auto. Mark only what you see this match — not a season claim.",
        helps: ["alliance"],
      },
      {
        key: "auto_fuel",
        label: "Auto fuel scored",
        type: "counter",
        required: true,
        helpText:
          "Fuel this robot scored during auto. Count what went in. Do not add missed shots or fuel they passed.",
        helps: ["pick_list"],
      },
      {
        key: "auto_climb",
        label: "Auto climb",
        type: "select",
        options: ["not_attempted", "failed", "succeeded"],
        helpText:
          "Auto climb this match. Use not attempted if they never tried — do not copy a climb from an earlier match.",
        helps: ["pick_list", "alliance"],
        // Opt out of auto_score inference (`auto_*`) — lookup reads this key separately.
        config: { role: "none" },
      },
      {
        key: "teleop_fuel",
        label: "Teleop fuel scored",
        type: "counter",
        required: true,
        helpText:
          "Fuel this robot scored in teleop. Do not add fuel they fed to a partner.",
        helps: ["pick_list"],
      },
      {
        key: "fuel_passed",
        label: "Fuel passed",
        type: "counter",
        helpText:
          "Fuel this robot fed to alliance partners. Alliance planning, not their own hub score.",
        helps: ["alliance"],
      },
      {
        key: "defense_time",
        label: "Contact defense",
        type: "timer",
        helpText:
          "Hold while they contact or pin an opponent. Release when they stop. Leave blank if they never played defense.",
        helps: ["alliance", "pick_list"],
        config: { mode: "total" },
      },
      {
        key: "camping_time",
        label: "Camping defense",
        type: "timer",
        helpText:
          "Hold while they block a trench, ramp, or pickup on purpose. Not the same as contact defense.",
        helps: ["alliance"],
        config: { mode: "total" },
      },
      {
        key: "tower_level",
        label: "Tower climb",
        type: "select",
        options: ["none", "L1", "L2", "L3", "failed"],
        helpText:
          "Highest tower level they completed this match. Use failed if they tried and did not make a level.",
        helps: ["pick_list", "alliance"],
        config: { role: "endgame" },
      },
      {
        key: "trench",
        label: "Trench this match",
        type: "boolean",
        helpText: "Check only if they drove under the trench in this match.",
        helps: ["alliance"],
      },
      {
        key: "bump",
        label: "Bump this match",
        type: "boolean",
        helpText: "Check only if they drove over the bump in this match.",
        helps: ["alliance"],
      },
      {
        key: "robot_roles",
        label: "Roles this match",
        type: "multi_select",
        options: ["cycling", "scoring", "feeding", "defending", "immobile"],
        helpText:
          "Roles they actually played for a significant part of this match. Do not mark a role you only saw earlier today.",
        helps: ["pick_list", "alliance"],
      },
      {
        key: "driver_ability",
        label: "Driver ability",
        type: "rating",
        helpText:
          "This match only. 1 = struggles to keep control, 3 = competent, 5 = precise and ahead of the match. Tap the same star to clear.",
        helps: ["pick_list"],
        config: { max: 5 },
      },
      {
        key: "defense_effectiveness",
        label: "Defense effectiveness",
        type: "rating",
        helpText:
          "How disruptive their defense was this match. 1 = no impact, 5 = highly disruptive. Leave blank if they did not play defense.",
        helps: ["alliance", "pick_list"],
        config: { max: 5 },
      },
      {
        key: "robot_broke",
        label: "Robot broke",
        type: "boolean",
        helpText:
          "Mechanical, electrical, or software failure during this match — not a slow cycle. Describe how in notes if you can.",
        helps: ["repair", "pick_list"],
      },
      {
        key: "disabled",
        label: "Disabled",
        type: "boolean",
        helpText:
          "Robot was dead, e-stopped, or fully out for a stretch of this match.",
        helps: ["pick_list", "repair"],
      },
      {
        key: "notes",
        label: "Notes",
        type: "text",
        helpText:
          "Only what the other questions missed: comms drops, penalties you are sure of, partner interaction. Keep it short.",
        helps: ["pick_list", "alliance", "repair"],
        widget: "free",
      },
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
        helpText: "What drive they built. Pushing matches and spare-parts planning — observable in the pit.",
        helps: ["pick_list", "alliance", "repair"],
      },
      {
        key: "drive_motors",
        label: "Drivetrain motors",
        type: "text",
        helpText: "Type and count so alliance partners know if they can loan a spare.",
        helps: ["repair", "alliance"],
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
        helpText: "How many seasons this driver has driven. How much alliance partners should coach in-match.",
        helps: ["alliance"],
      },
      {
        key: "coach_seasons",
        label: "Coach seasons of experience",
        type: "number",
        helpText: "How many seasons the drive coach has coached. How hands-on partners should be.",
        helps: ["alliance"],
      },
      {
        key: "robot_images",
        label: "Robot images",
        type: "robot_image",
        helpText: "Front and side pit photos. The useful pit artifact for pick list and repair.",
        helps: ["pick_list", "pit", "repair"],
      },
      {
        key: "trench",
        label: "Goes under trench",
        type: "boolean",
        helpText: "Physical clearance under the trench. Confirm in the pit.",
        helps: ["alliance", "pit"],
      },
      {
        key: "bump",
        label: "Goes over bump",
        type: "boolean",
        helpText: "Can they clear the bump hardware. Confirm in the pit.",
        helps: ["alliance", "pit"],
      },
      {
        key: "intake_visible",
        label: "Intake hardware",
        type: "select",
        options: ["ground", "outpost", "both", "neither"],
        helpText:
          "Intake hardware you can see: ground, hopper/outpost, both, or neither. Not how many they score.",
        helps: ["alliance", "pit"],
      },
      {
        key: "notes",
        label: "Notes",
        type: "text",
        helpText:
          "Repair and alliance facts the checkboxes miss: bumper issues, known failures, radio language.",
        helps: ["repair", "pick_list", "pit"],
        widget: "free",
      },
    ],
  },
  strategyTemplates: ["safe_fuel", "balanced", "climb_first"],
  brief: {
    headline: "Fuel on the field, then a tower climb",
    whatWeKnow: [
      "The published manual scores auto fuel, teleop fuel, and fuel passed.",
      "Endgame is a tower climb: none, L1, L2, or L3.",
      "Trench and bump are traversal facts you confirm in the pit and mark per match.",
    ],
    scoutFirst: [
      "Count auto fuel, teleop fuel, and fuel passed — only what happened this match.",
      "Record the tower climb level you actually saw, including a failed attempt.",
      "Time contact defense and camping separately; rate the driver and defense only for this match.",
      "In the pit: drivetrain, motors, language, driver seasons, photos, clearance, and visible intake.",
    ],
    designQuestions: [
      "Do we score fuel in auto, pass it, or both?",
      "What tower level can we climb if a partner is dead?",
      "Do we fit the trench, clear the bump, or play the open field?",
    ],
  },
};
