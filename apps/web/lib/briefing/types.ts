// One Pre-Match Briefing — consolidated domain types. Pure data shapes only.
//
// The briefing is THE pre-match surface: it fuses everything real the org has
// for one match. These types extend the original BriefingView (lib/briefing.ts)
// with the sections that previously lived on /match-copilot (EPA, FMEA risks,
// battery health, callouts) and the other pre-match tools (strategy cards,
// opponent watchlist, defense planner, pit-repair triage). Every section is
// nullable/empty — the UI renders honest per-section empty states, never demo
// numbers.

import type { BriefingView } from "../briefing";
import type {
  MatchCopilotBattery,
  MatchCopilotCallout,
  MatchCopilotRisk,
  MatchCopilotTeam,
} from "../match-copilot/types";

/** Scout-derived per-robot capabilities, read from the saved strategy plan
 * (match_strategies.plan.operations — written by computeStrategyView, which
 * runs the scout→strategy form-builder role bridge). */
export type BriefingScoutedTeam = {
  teamKey: string;
  scoutSample: number;
  autoCapability: number | null;
  teleopCapability: number | null;
  endgameCapability: number | null;
  defenseLikely: boolean | null;
  foulRate: number | null;
  pitNotes: string[];
};

/** Opponent tendency labels + evidence from the saved strategy plan. */
export type BriefingTendency = {
  teamKey: string;
  labels: string[];
  evidence: string[];
};

/** Human-authored printable card for this match (match_strategy_cards). */
export type BriefingCard = {
  gamePlan: string | null;
  autoAssignment: string | null;
  defenseFocus: string | null;
  keyThreats: string | null;
  driverNotes: string | null;
  roleAssignments: Array<{ role: string; assignee: string }>;
  updatedAt: string | null;
};

/** A member's watchlist note about an opponent in this match. */
export type BriefingWatchNote = {
  teamKey: string;
  teamNumber: number | null;
  note: string;
  createdAt: string;
};

/** Latest defense-planner recommendation against an opponent in this match. */
export type BriefingDefensePlan = {
  opponentTeamNumber: number;
  opponentTeamName: string;
  recommendation: "play_defense" | "stay_offense" | "situational";
  assignedDefender: "us" | "none" | "situational";
  confidence: number;
  rationale: string;
  computedAt: string;
};

/** Open/staged pit-repair triage report for OUR robot this season. */
export type BriefingPitReport = {
  id: string;
  title: string;
  subsystemName: string;
  decision: "fix" | "swap" | "monitor";
  status: "open" | "staged";
  prestageRecommended: boolean;
  createdAt: string;
};

/** Sections added by the consolidation on top of the original briefing. */
export type BriefingExtras = {
  /** EPA/rank rows for alliance partners (excluding us). */
  allyTeams: MatchCopilotTeam[];
  /** EPA/rank rows for opposing robots. */
  opponentTeams: MatchCopilotTeam[];
  ourEpaTotal: number | null;
  alliesScouted: BriefingScoutedTeam[];
  opponentsScouted: BriefingScoutedTeam[];
  tendencies: BriefingTendency[];
  card: BriefingCard | null;
  watchNotes: BriefingWatchNote[];
  defensePlans: BriefingDefensePlan[];
  pitReports: BriefingPitReport[];
  openRisks: MatchCopilotRisk[];
  batteries: MatchCopilotBattery[];
  /** Prioritized do-this callouts (formerly Match Copilot's brief). */
  callouts: MatchCopilotCallout[];
};

export type FullBriefingView =
  | (Extract<BriefingView, { status: "ready" }> & BriefingExtras)
  | Extract<BriefingView, { status: "setup_required" }>;
