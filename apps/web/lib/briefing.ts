// Pre-Match Briefing — framework-free domain logic shared by the API route,
// the client UI, and unit tests. No server or React imports belong here.
//
// The briefing is a read-only fusion view: it reuses driver-practice metrics
// (sessionStats/actionBreakdown) and renders honest "not available" hints for
// anything the team has not produced yet — it never invents data.

import { actionBreakdown, sessionStats, type DriverSession } from "./driver-practice";

export type BriefingMatch = {
  matchKey: string;
  compLevel: string;
  matchNumber: number;
  /** COALESCE(actual_time, predicted_time, event_time) as text, or null. */
  scheduledTime: string | null;
  red: string[];
  blue: string[];
};

export type BriefingPrediction = {
  pRed: number;
  pBlue: number;
  confidenceLow: number;
  confidenceHigh: number;
  modelVersion: string;
  keyFactors: Array<{ name: string; alliance: string; impact: number; evidence: string }>;
  caveats: string[];
  scoredAt: string | null;
};

export type BriefingPlan = {
  title: string | null;
  priorities: string[];
  strengths: string[];
  risks: string[];
  checkpoints: string[];
};

export type BriefingPlay = {
  id: string;
  title: string;
  description: string;
  strokeCount: number;
  updatedAt: string;
};

export type PracticeReadiness = {
  reps: number;
  successRate: number | null;
  avgSeconds: number | null;
  bestSeconds: number | null;
  topActions: Array<{ action: string; reps: number; successRate: number | null; avgSeconds: number | null }>;
};

export type OpponentIntel = {
  teamKey: string;
  reviewTitle: string;
  notes: Array<{ atSeconds: number; tag: string; body: string }>;
};

export type BriefingContext = {
  orgId: string | null;
  orgName: string | null;
  teamNumber: number | null;
  role: string | null;
  eventKey: string | null;
  eventName: string | null;
};

export type BriefingView =
  | {
      status: "ready";
      context: BriefingContext;
      match: BriefingMatch;
      ourAlliance: "red" | "blue" | null;
      prediction: BriefingPrediction | null;
      plan: BriefingPlan | null;
      play: BriefingPlay | null;
      practice: PracticeReadiness;
      opponentIntel: OpponentIntel[];
      scoutCount: number;
      ourMatches: Array<{ matchKey: string; label: string }>;
    }
  | { status: "setup_required"; context: BriefingContext; message: string };

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested).
// ---------------------------------------------------------------------------

/** Which alliance contains the team, or null when it is not in the match. */
export function ourAllianceOf(match: BriefingMatch, teamKey: string): "red" | "blue" | null {
  if (match.red.includes(teamKey)) return "red";
  if (match.blue.includes(teamKey)) return "blue";
  return null;
}

/** Stored win probability for the given alliance (0–1), or null when either side is unknown. */
export function winProbabilityFor(
  prediction: BriefingPrediction | null,
  alliance: "red" | "blue" | null,
): number | null {
  if (!prediction || !alliance) return null;
  return alliance === "red" ? prediction.pRed : prediction.pBlue;
}

/** Coerce unknown JSON into a trimmed string array, dropping non-primitive entries. */
function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string | number => typeof entry === "string" || typeof entry === "number")
    .map((entry) => String(entry).trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Read the saved strategy `plan` JSONB defensively: only `plan.playbook`
 * {title, priorities, strengthsToProtect, risksToMitigate, checkpoints} is
 * used, every field is optional, and null is returned when nothing usable
 * survives — the UI then shows the honest "save a playbook" hint instead.
 */
export function normalizePlan(planJson: unknown): BriefingPlan | null {
  if (!planJson || typeof planJson !== "object" || Array.isArray(planJson)) return null;
  const playbook = (planJson as Record<string, unknown>).playbook;
  if (!playbook || typeof playbook !== "object" || Array.isArray(playbook)) return null;
  const record = playbook as Record<string, unknown>;
  const title = typeof record.title === "string" && record.title.trim() ? record.title.trim() : null;
  const plan: BriefingPlan = {
    title,
    priorities: stringList(record.priorities),
    strengths: stringList(record.strengthsToProtect),
    risks: stringList(record.risksToMitigate),
    checkpoints: stringList(record.checkpoints),
  };
  const usable =
    plan.title != null ||
    plan.priorities.length > 0 ||
    plan.strengths.length > 0 ||
    plan.risks.length > 0 ||
    plan.checkpoints.length > 0;
  return usable ? plan : null;
}

/**
 * Drive-team readiness across recent practice sessions: overall reps, success
 * rate, average/best cycle times, and the three most-practiced actions.
 * Built on the driver-practice metrics so numbers match the /practice page.
 */
export function practiceReadiness(sessions: DriverSession[]): PracticeReadiness {
  const cycles = sessions.flatMap((session) => session.cycles);
  const stats = sessionStats(cycles);
  const topActions = actionBreakdown(cycles)
    .slice(0, 3)
    .map((entry) => ({
      action: entry.action,
      reps: entry.reps,
      successRate: entry.successRate,
      avgSeconds: entry.avgSeconds,
    }));
  return {
    reps: stats.reps,
    successRate: stats.successRate,
    avgSeconds: stats.avgSeconds,
    bestSeconds: stats.bestSeconds,
    topActions,
  };
}

export type BriefingChecklistInput = {
  hasPrediction: boolean;
  hasPlan: boolean;
  hasPlay: boolean;
  practiceReps: number;
  intelCount: number;
  scoutCount: number;
  hasCard?: boolean;
  hasCounterBooks?: boolean;
  hasWatchNotes?: boolean;
  hasDefensePlans?: boolean;
};

export type BriefingChecklistRow = { label: string; ok: boolean; hint: string };

/** Readiness rows with honest do-this-next hints for whatever is missing. */
export function briefingChecklist(input: BriefingChecklistInput): BriefingChecklistRow[] {
  return [
    { label: "Prediction", ok: input.hasPrediction, hint: "Run /strategy" },
    { label: "Strategy plan", ok: input.hasPlan, hint: "Save a playbook in /strategy" },
    { label: "Match card", ok: Boolean(input.hasCard), hint: "Write one in /match-strategy-cards" },
    { label: "Counter-book", ok: Boolean(input.hasCounterBooks), hint: "Log how we beat them in /counter-book" },
    { label: "Watchlist", ok: Boolean(input.hasWatchNotes), hint: "Add a threat in /opponent-watchlist" },
    { label: "Defense plan", ok: Boolean(input.hasDefensePlans), hint: "Plan in /defense-planner" },
    { label: "Whiteboard play", ok: input.hasPlay, hint: "Draw one in /whiteboard and link the match" },
    { label: "Practice data", ok: input.practiceReps > 0, hint: "Log reps in /practice" },
    { label: "Opponent video", ok: input.intelCount > 0, hint: "Tag opponent reviews in /video" },
  ];
}

const LEVEL_LABELS: Record<string, string> = {
  qm: "Qual",
  qf: "QF",
  sf: "SF",
  f: "Final",
};

/** "Qual 42"-style label: qm→Qual, qf→QF, sf→SF, f→Final, else uppercased level. */
export function matchLabel(compLevel: string, matchNumber: number): string {
  return `${LEVEL_LABELS[compLevel] ?? compLevel.toUpperCase()} ${matchNumber}`;
}
