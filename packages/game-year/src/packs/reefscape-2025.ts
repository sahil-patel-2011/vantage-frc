import { withFieldCentric } from "../field-centric";
import type { GameYearPack } from "../types";

/** Published reference: https://firstfrc.blob.core.windows.net/frc2025/Manual/2025GameManual.pdf */
export const REEFSCAPE_2025: GameYearPack = {
  year: 2025, gameName: "REEFSCAPE", seasonTheme: "FIRST DIVE", status: "published",
  scoringKeys: ["auto_coral", "teleop_coral", "algae_processor", "algae_net", "endgame"],
  matchSchema: {
    title: "2025 REEFSCAPE match",
    fields: withFieldCentric([
      { key: "auto_coral", label: "Auto coral scored", type: "number", config: { scoutPhase: "auto", requireObservation: true, min: 0, integer: true } },
      { key: "teleop_coral", label: "Teleop coral scored", type: "number", config: { scoutPhase: "teleop", requireObservation: true, min: 0, integer: true } },
      { key: "algae_processor", label: "Algae delivered to processor", type: "number", config: { scoutPhase: "teleop", requireObservation: true, min: 0, integer: true } },
      { key: "algae_net", label: "Algae scored in net", type: "number", config: { scoutPhase: "teleop", requireObservation: true, min: 0, integer: true } },
      { key: "endgame", label: "Barge finish", type: "select", options: ["none", "park", "shallow", "deep"], config: { scoutPhase: "endgame" } },
      { key: "disabled", label: "Disabled", type: "boolean" },
      { key: "notes", label: "Notes", type: "text" },
    ]),
  },
  pitSchema: { title: "2025 REEFSCAPE pit", fields: [
    { key: "drivetrain_type", label: "Drivetrain", type: "drivetrain_type", options: ["swerve", "west_coast", "tank", "mecanum", "other"] },
    { key: "coral_levels", label: "Coral levels reached", type: "text" },
    { key: "algae_processor", label: "Can deliver algae to processor", type: "boolean" },
    { key: "algae_net", label: "Can score algae in net", type: "boolean" },
    { key: "climb", label: "Cage climb", type: "select", options: ["none", "shallow", "deep"] },
    { key: "notes", label: "Notes", type: "text" },
  ] },
  strategyTemplates: ["coral", "algae", "balanced"],
  brief: {
    headline: "Coral on the reef, algae in the processor or net, then finish at the barge",
    whatWeKnow: ["Coral scores at four reef levels. Removing algae opens more reef branches.", "Algae can be delivered through the processor or scored in the net.", "Robots can park or climb a shallow or deep cage at the barge."],
    scoutFirst: ["Record autonomous and teleop coral separately, with levels in your notes.", "Count processor and net algae separately; leave unseen counts blank.", "Record the observed barge finish and any downtime."],
    designQuestions: ["Which coral levels can we reach reliably?", "Can we clear algae for a partner?", "Which cage can we climb consistently?"],
  },
};
