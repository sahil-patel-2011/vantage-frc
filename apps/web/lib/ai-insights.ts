// AI Insights — pure builders that turn org data into (a) bounded, provenance-
// classified context sources for the metered AIOrchestrator pipeline and (b) a
// deterministic local analysis text (the dev/local provider output, mirroring
// LocalSummaryProvider). Framework-free; no server or React imports.

import { predictionAccuracy } from "@vantage/prediction-strategy";
import { memberLeaderboard, summarizeHours, type HourLog, type HourMember } from "./build-hours";
import { actionBreakdown, sessionStats, type DriverSession } from "./driver-practice";
import {
  groupByCategory,
  inspectionProgress,
  weightStatus,
  type InspectionItem,
  type RobotWeight,
} from "./inspection";
import { bomCoverage, isLowStock, type BomEntry, type InventoryItem } from "./inventory";
import { pointsPerSecond, rankActions, type DesignPriority, type ScoringAction } from "./kickoff";
import { daysUntil, type Milestone } from "./season-calendar";
import { fmtTimestamp, tagCounts, type VideoReview } from "./video-review";

export const INSIGHT_KINDS = [
  "practice_coach",
  "inspection_advisor",
  "stock_advisor",
  "kickoff_strategist",
  "schedule_risk",
  "video_scout_summary",
  "engagement_digest",
  "model_accuracy",
] as const;
export type InsightKind = (typeof INSIGHT_KINDS)[number];

/** Capability routing per insight (must be a capability the orchestrator accepts). */
export const INSIGHT_CAPABILITY: Record<InsightKind, "strategy" | "maintenance" | "team_intel" | "prediction"> = {
  practice_coach: "strategy",
  inspection_advisor: "maintenance",
  stock_advisor: "maintenance",
  kickoff_strategist: "strategy",
  schedule_risk: "strategy",
  video_scout_summary: "team_intel",
  engagement_digest: "team_intel",
  model_accuracy: "prediction",
};

export const INSIGHT_TITLES: Record<InsightKind, string> = {
  practice_coach: "Practice coach",
  inspection_advisor: "Inspection advisor",
  stock_advisor: "Stock advisor",
  kickoff_strategist: "Kickoff strategist",
  schedule_risk: "Schedule risk",
  video_scout_summary: "Video scout summary",
  engagement_digest: "Engagement digest",
  model_accuracy: "Prediction accuracy",
};

/** Shape accepted by the orchestrator's contextSources (subset we produce). */
export type InsightSource = {
  type: "module_data";
  id: string;
  content: string;
  importance: number;
  classification: "hard_metric" | "scout_observation" | "model_inference";
};

export type BuiltInsight = {
  message: string;
  sources: InsightSource[];
  localText: string;
};

const round1 = (value: number) => Math.round(value * 10) / 10;

// ---------------------------------------------------------------------------
// Practice coach — what should the drive team drill next?
// ---------------------------------------------------------------------------

export function buildPracticeCoachInsight(sessions: DriverSession[]): BuiltInsight {
  const allCycles = sessions.flatMap((session) => session.cycles);
  const overall = sessionStats(allCycles);
  const breakdown = actionBreakdown(allCycles);

  const sources: InsightSource[] = [
    {
      type: "module_data",
      id: "practice:overall",
      content: JSON.stringify(overall),
      importance: 1,
      classification: "hard_metric",
    },
    ...sessions.slice(0, 12).map((session) => ({
      type: "module_data" as const,
      id: `practice:session:${session.id}`,
      content: JSON.stringify({
        title: session.title,
        date: session.sessionDate,
        goal: session.goal,
        stats: sessionStats(session.cycles),
      }),
      importance: 0.85,
      classification: "scout_observation" as const,
    })),
    ...breakdown.slice(0, 10).map((row) => ({
      type: "module_data" as const,
      id: `practice:action:${row.action}`,
      content: JSON.stringify(row),
      importance: 0.9,
      classification: "hard_metric" as const,
    })),
  ];

  let localText: string;
  if (overall.reps === 0) {
    localText =
      "No practice reps are logged yet. Run a session and log each cycle (timed where possible) before asking for coaching.";
  } else {
    const lines: string[] = [];
    lines.push(
      `Across ${sessions.length} session${sessions.length === 1 ? "" : "s"} the drive team logged ${overall.reps} reps at ${
        overall.successRate ?? 0
      }% success${overall.avgSeconds != null ? ` and a ${overall.avgSeconds}s average cycle` : ""}${
        overall.bestSeconds != null ? ` (best ${overall.bestSeconds}s)` : ""
      }.`,
    );

    const rated = breakdown.filter((row) => row.reps >= 3 && row.successRate != null);
    const weakest = [...rated].sort((a, b) => (a.successRate ?? 0) - (b.successRate ?? 0))[0];
    const strongest = [...rated].sort((a, b) => (b.successRate ?? 0) - (a.successRate ?? 0))[0];
    if (strongest && (strongest.successRate ?? 0) >= 80) {
      lines.push(`"${strongest.action}" is match-ready at ${strongest.successRate}% over ${strongest.reps} reps — protect it.`);
    }
    if (weakest && (weakest.successRate ?? 100) < 70) {
      lines.push(
        `Priority drill: "${weakest.action}" sits at ${weakest.successRate}% over ${weakest.reps} reps${
          weakest.avgSeconds != null ? ` (${weakest.avgSeconds}s avg)` : ""
        } — schedule focused reps before the next event.`,
      );
    }

    // Trend: latest session vs everything before it.
    if (sessions.length >= 2) {
      const [latest, ...rest] = sessions;
      const latestStats = sessionStats(latest!.cycles);
      const before = sessionStats(rest.flatMap((session) => session.cycles));
      if (latestStats.avgSeconds != null && before.avgSeconds != null) {
        const delta = round1(before.avgSeconds - latestStats.avgSeconds);
        if (Math.abs(delta) >= 0.3) {
          lines.push(
            delta > 0
              ? `Cycle time improved ${delta}s in the latest session (${latestStats.avgSeconds}s vs ${before.avgSeconds}s prior).`
              : `Cycle time regressed ${Math.abs(delta)}s in the latest session — check what changed before locking strategy.`,
          );
        }
      }
    }
    if (overall.timed === 0) {
      lines.push("No reps are timed yet — use the stopwatch so cycle-time trends become visible.");
    }
    localText = lines.join(" ");
  }

  return {
    message: "Coach the drive team: analyze the practice log and recommend what to drill next.",
    sources,
    localText,
  };
}

// ---------------------------------------------------------------------------
// Inspection advisor — what blocks passing inspection?
// ---------------------------------------------------------------------------

export function buildInspectionAdvisorInsight(input: {
  items: InspectionItem[];
  weights: RobotWeight[];
  weightLimitLbs: number;
  robotLabel: string;
}): BuiltInsight {
  const progress = inspectionProgress(input.items);
  const scale = weightStatus(input.weights, input.weightLimitLbs);
  const groups = groupByCategory(input.items);
  const fails = input.items.filter((item) => item.status === "fail");

  const sources: InsightSource[] = [
    {
      type: "module_data",
      id: `inspection:progress:${input.robotLabel}`,
      content: JSON.stringify(progress),
      importance: 1,
      classification: "hard_metric",
    },
    {
      type: "module_data",
      id: `inspection:weight:${input.robotLabel}`,
      content: JSON.stringify({ latest: scale.latest?.totalLbs ?? null, limit: input.weightLimitLbs, margin: scale.marginLbs }),
      importance: 1,
      classification: "hard_metric",
    },
    ...fails.slice(0, 12).map((item) => ({
      type: "module_data" as const,
      id: `inspection:fail:${item.id}`,
      content: JSON.stringify({ category: item.category, requirement: item.requirement, note: item.note }),
      importance: 0.95,
      classification: "scout_observation" as const,
    })),
  ];

  const lines: string[] = [];
  if (progress.total === 0) {
    lines.push(`No checklist exists yet for "${input.robotLabel}" — load the standard checklist first.`);
  } else {
    lines.push(
      `Self-inspection for "${input.robotLabel}" is ${progress.percent}% resolved (${progress.pass} pass, ${progress.fail} fail, ${progress.pending} open).`,
    );
    if (scale.over && scale.marginLbs != null) {
      lines.push(
        `URGENT: latest weigh-in is ${Math.abs(scale.marginLbs)} lb over the ${input.weightLimitLbs} lb limit — shed weight before anything else.`,
      );
    } else if (scale.latest && scale.marginLbs != null) {
      lines.push(`Weight is under the limit with ${scale.marginLbs} lb of margin (${scale.latest.totalLbs} lb).`);
    } else {
      lines.push("No weigh-in is logged — weigh the robot so there are no surprises at the event scale.");
    }
    if (fails.length) {
      const listed = fails
        .slice(0, 5)
        .map((item) => `${item.category}: ${item.requirement}${item.note ? ` (${item.note})` : ""}`)
        .join("; ");
      lines.push(`Fix the failing item${fails.length === 1 ? "" : "s"} first — ${listed}${fails.length > 5 ? "; …" : ""}.`);
    }
    const openCategories = groups
      .map((group) => ({ category: group.category, open: group.items.filter((item) => item.status === "pending").length }))
      .filter((group) => group.open > 0);
    if (openCategories.length) {
      lines.push(
        `Still unchecked: ${openCategories.map((group) => `${group.category} (${group.open})`).join(", ")} — walk these with the checklist in hand.`,
      );
    }
    if (progress.ready && !scale.over) {
      lines.push("Everything passes — do a final battery-secure and bumper check the morning of inspection.");
    }
  }

  return {
    message: `Advise the pit crew: what blocks robot "${input.robotLabel}" from passing FRC inspection, in priority order?`,
    sources,
    localText: lines.join(" "),
  };
}

// ---------------------------------------------------------------------------
// Stock advisor — what should the team reorder before the next event?
// ---------------------------------------------------------------------------

export function buildStockAdvisorInsight(input: { items: InventoryItem[]; bom: BomEntry[] }): BuiltInsight {
  const active = input.items.filter((item) => !item.archived);
  const low = active.filter((item) => isLowStock(item));
  const coverage = bomCoverage(input.bom, input.items);
  const shortSubsystems = coverage.filter((subsystem) => !subsystem.buildable);

  const reorder = low.map((item) => {
    const needed = Math.max(0, Math.round((item.minQuantity * 2 - item.quantity) * 100) / 100);
    return {
      name: item.name,
      onHand: item.quantity,
      threshold: item.minQuantity,
      suggested: needed,
      estCost: item.unitCost != null ? Math.round(needed * item.unitCost * 100) / 100 : null,
    };
  });
  const totalCost = reorder.reduce((sum, row) => sum + (row.estCost ?? 0), 0);

  const sources: InsightSource[] = [
    {
      type: "module_data",
      id: "inventory:reorder",
      content: JSON.stringify(reorder.slice(0, 20)),
      importance: 1,
      classification: "hard_metric",
    },
    ...shortSubsystems.slice(0, 10).map((subsystem) => ({
      type: "module_data" as const,
      id: `inventory:bom:${subsystem.subsystem}`,
      content: JSON.stringify({
        subsystem: subsystem.subsystem,
        short: subsystem.lines.filter((line) => line.short > 0),
      }),
      importance: 0.9,
      classification: "hard_metric" as const,
    })),
  ];

  const lines: string[] = [];
  if (active.length === 0) {
    lines.push("No inventory is tracked yet — add parts and reorder thresholds before asking for a stock brief.");
  } else if (low.length === 0 && shortSubsystems.length === 0) {
    lines.push(`Stock is healthy: ${active.length} tracked items, none at reorder threshold, and every BOM subsystem is buildable.`);
  } else {
    if (low.length) {
      const listed = reorder
        .slice(0, 6)
        .map((row) => `${row.name} (have ${row.onHand}, order ~${row.suggested}${row.estCost != null ? ` ≈ $${row.estCost}` : ""})`)
        .join("; ");
      lines.push(`${low.length} item${low.length === 1 ? " is" : "s are"} at/below reorder threshold: ${listed}${low.length > 6 ? "; …" : ""}.`);
    }
    if (shortSubsystems.length) {
      lines.push(
        `BOM shortfalls block ${shortSubsystems.length} subsystem${shortSubsystems.length === 1 ? "" : "s"}: ${shortSubsystems
          .map((subsystem) => `${subsystem.subsystem} (${subsystem.shortCount} part${subsystem.shortCount === 1 ? "" : "s"} short)`)
          .join(", ")} — order these before build hours are lost waiting on parts.`,
      );
    }
    if (totalCost > 0) {
      lines.push(`Estimated reorder spend for costed items: ~$${Math.round(totalCost * 100) / 100}.`);
    }
  }

  return {
    message: "Advise the team: what should be reordered before the next event, and what BOM shortfalls block builds?",
    sources,
    localText: lines.join(" "),
  };
}

// ---------------------------------------------------------------------------
// Kickoff strategist — does the design commit to the highest-value actions?
// ---------------------------------------------------------------------------

export function buildKickoffStrategistInsight(input: {
  actions: ScoringAction[];
  priorities: DesignPriority[];
  seasonYear: number;
}): BuiltInsight {
  const ranked = rankActions(input.actions);
  const topFive = ranked.slice(0, 5);
  const committed = input.priorities.filter((priority) => priority.status === "committed");
  const activePriorities = input.priorities.filter((priority) => priority.status !== "cut");

  const phaseTotals = new Map<string, number>();
  for (const action of input.actions) {
    phaseTotals.set(action.phase, (phaseTotals.get(action.phase) ?? 0) + action.points);
  }
  const totalPoints = [...phaseTotals.values()].reduce((sum, value) => sum + value, 0);

  const sources: InsightSource[] = [
    ...ranked.slice(0, 12).map((action) => ({
      type: "module_data" as const,
      id: `kickoff:action:${action.id}`,
      content: JSON.stringify({ label: action.label, phase: action.phase, points: action.points, ptsPerSec: pointsPerSecond(action) }),
      importance: 1,
      classification: "hard_metric" as const,
    })),
    ...input.priorities.slice(0, 12).map((priority) => ({
      type: "module_data" as const,
      id: `kickoff:priority:${priority.id}`,
      content: JSON.stringify({ capability: priority.capability, weight: priority.weight, status: priority.status }),
      importance: 0.9,
      classification: "scout_observation" as const,
    })),
  ];

  const lines: string[] = [];
  if (input.actions.length === 0) {
    lines.push(
      `No scoring actions are entered for ${input.seasonYear} — fill the scoring analysis table (points + estimated cycle time per action) before asking for strategy.`,
    );
  } else {
    const described = topFive
      .map((action) => {
        const rate = pointsPerSecond(action);
        return `${action.label} (${action.points} pts${rate != null ? `, ${rate}/s` : ""})`;
      })
      .join("; ");
    lines.push(`Top value actions for ${input.seasonYear}: ${described}.`);

    if (totalPoints > 0) {
      const endgame = phaseTotals.get("endgame") ?? 0;
      const auto = phaseTotals.get("auto") ?? 0;
      const endgameShare = Math.round((endgame / totalPoints) * 100);
      const autoShare = Math.round((auto / totalPoints) * 100);
      if (endgameShare >= 25) lines.push(`Endgame carries ${endgameShare}% of listed points — a reliable endgame is non-negotiable.`);
      if (autoShare >= 25) lines.push(`Auto carries ${autoShare}% of listed points — invest in autonomous early.`);
    }

    const linkedActionIds = new Set(activePriorities.map((priority) => priority.linkedActionId).filter(Boolean));
    const uncovered = topFive.filter((action) => !linkedActionIds.has(action.id));
    if (committed.length) {
      lines.push(`Committed capabilities: ${committed.map((priority) => priority.capability).join(", ")}.`);
    } else {
      lines.push("No capability is committed yet — converge the priority matrix before CAD starts.");
    }
    if (uncovered.length && input.priorities.length) {
      lines.push(
        `Coverage gap: ${uncovered.map((action) => `"${action.label}"`).join(", ")} rank in the top value actions but no active priority links to them — prototype them or cut them deliberately.`,
      );
    }
  }

  return {
    message: `Act as a kickoff strategist for the ${input.seasonYear} game: which scoring actions should this team commit to, and where are the gaps?`,
    sources,
    localText: lines.join(" "),
  };
}

// ---------------------------------------------------------------------------
// Schedule risk — is the build season on pace?
// ---------------------------------------------------------------------------

export function buildScheduleRiskInsight(milestones: Milestone[], now = Date.now()): BuiltInsight {
  // season-calendar's daysUntil takes a Date reference point.
  const ref = new Date(now);
  const until = (dateISO: string) => daysUntil(dateISO, ref);
  const open = milestones.filter((milestone) => !milestone.done);
  const overdue = open
    .filter((milestone) => until(milestone.startsOn) < 0)
    .sort((a, b) => until(a.startsOn) - until(b.startsOn));
  const thisWeek = open.filter((milestone) => {
    const days = until(milestone.startsOn);
    return days >= 0 && days <= 7;
  });
  const nextEvent = open
    .filter((milestone) => milestone.kind === "event")
    .sort((a, b) => (a.startsOn < b.startsOn ? -1 : 1))[0];
  const done = milestones.filter((milestone) => milestone.done).length;

  const sources: InsightSource[] = [
    {
      type: "module_data",
      id: "calendar:pace",
      content: JSON.stringify({ total: milestones.length, done, overdue: overdue.length, dueThisWeek: thisWeek.length }),
      importance: 1,
      classification: "hard_metric",
    },
    ...overdue.slice(0, 8).map((milestone) => ({
      type: "module_data" as const,
      id: `calendar:overdue:${milestone.id}`,
      content: JSON.stringify({ title: milestone.title, kind: milestone.kind, daysLate: -until(milestone.startsOn) }),
      importance: 0.95,
      classification: "scout_observation" as const,
    })),
  ];

  const lines: string[] = [];
  if (milestones.length === 0) {
    lines.push("No milestones exist yet — seed the build-season template from your kickoff date to get a pace read.");
  } else {
    if (overdue.length) {
      const listed = overdue
        .slice(0, 4)
        .map((milestone) => `${milestone.title} (${-until(milestone.startsOn)}d late)`)
        .join("; ");
      lines.push(`${overdue.length} milestone${overdue.length === 1 ? " is" : "s are"} overdue: ${listed}${overdue.length > 4 ? "; …" : ""}.`);
    } else {
      lines.push(`No overdue milestones — ${done}/${milestones.length} complete.`);
    }
    if (thisWeek.length) {
      lines.push(`Due within 7 days: ${thisWeek.map((milestone) => milestone.title).join(", ")}.`);
    }
    if (nextEvent) {
      const eventDays = until(nextEvent.startsOn);
      if (eventDays >= 0) {
        lines.push(
          overdue.length
            ? `"${nextEvent.title}" is in ${eventDays} day${eventDays === 1 ? "" : "s"} with ${overdue.length} overdue prerequisite${overdue.length === 1 ? "" : "s"} — recover this week or descope deliberately.`
            : `"${nextEvent.title}" is in ${eventDays} day${eventDays === 1 ? "" : "s"} and the plan is current.`,
        );
      }
    }
  }

  return {
    message: "Assess build-season schedule risk from the milestone plan: what is late, what is due, and what threatens the next event?",
    sources,
    localText: lines.join(" "),
  };
}

// ---------------------------------------------------------------------------
// Video scout summary — what did match footage teach us?
// ---------------------------------------------------------------------------

export function buildVideoScoutSummaryInsight(reviews: VideoReview[]): BuiltInsight {
  const allNotes = reviews.flatMap((review) => review.notes);
  const counts = tagCounts(allNotes);
  const mostNoted = [...reviews].sort((a, b) => b.notes.length - a.notes.length)[0];
  const failures = reviews.flatMap((review) =>
    review.notes
      .filter((note) => note.tag === "failure")
      .map((note) => `${review.title} @ ${fmtTimestamp(note.atSeconds)}: ${note.body}`),
  );
  const defense = reviews.flatMap((review) =>
    review.notes
      .filter((note) => note.tag === "defense")
      .map((note) => `${review.title} @ ${fmtTimestamp(note.atSeconds)}: ${note.body}`),
  );

  const sources: InsightSource[] = [
    {
      type: "module_data",
      id: "video:tags",
      content: JSON.stringify(counts),
      importance: 1,
      classification: "hard_metric",
    },
    ...allNotes.slice(0, 24).map((note) => ({
      type: "module_data" as const,
      id: `video:note:${note.id}`,
      content: JSON.stringify({ tag: note.tag, at: note.atSeconds, body: note.body }),
      importance: 0.9,
      classification: "scout_observation" as const,
    })),
  ];

  const lines: string[] = [];
  if (allNotes.length === 0) {
    lines.push("No timestamped video notes yet — review match footage and tag observations before asking for a summary.");
  } else {
    lines.push(
      `${allNotes.length} timestamped note${allNotes.length === 1 ? "" : "s"} across ${reviews.length} review${reviews.length === 1 ? "" : "s"}.`,
    );
    const tagLine = Object.entries(counts)
      .filter(([, count]) => count > 0)
      .map(([tag, count]) => `${tag} ${count}`)
      .join(", ");
    if (tagLine) lines.push(`By tag: ${tagLine}.`);
    if (failures.length) {
      lines.push(`Failures observed — ${failures.slice(0, 3).join("; ")}${failures.length > 3 ? "; …" : ""}.`);
    }
    if (defense.length) {
      lines.push(`Defense observations — ${defense.slice(0, 3).join("; ")}${defense.length > 3 ? "; …" : ""}.`);
    }
    if (mostNoted && mostNoted.notes.length > 0) {
      lines.push(`Deepest review: "${mostNoted.title}" (${mostNoted.notes.length} notes)${mostNoted.matchKey ? ` on ${mostNoted.matchKey}` : ""}.`);
    }
  }

  return {
    message: "Summarize what the team's match-video reviews reveal: recurring failures, defense patterns, and where to look next.",
    sources,
    localText: lines.join(" "),
  };
}

// ---------------------------------------------------------------------------
// Engagement digest — mentor's read on shop-hours participation.
// ---------------------------------------------------------------------------

export function buildEngagementDigestInsight(
  input: { records: HourLog[]; members: HourMember[]; goalHours: number },
  now = Date.now(),
): BuiltInsight {
  const summary = summarizeHours(input.records, now);
  const board = memberLeaderboard(input.records, input.members, input.goalHours, now);
  const zeroHour = board.filter((row) => row.totalHours === 0);
  const atGoal = board.filter((row) => row.goalPercent != null && row.goalPercent >= 100);
  const top = board.slice(0, 3).filter((row) => row.totalHours > 0);

  const sources: InsightSource[] = [
    {
      type: "module_data",
      id: "hours:summary",
      content: JSON.stringify(summary),
      importance: 1,
      classification: "hard_metric",
    },
    {
      type: "module_data",
      id: "hours:board",
      content: JSON.stringify(board.slice(0, 20).map((row) => ({ name: row.name, hours: row.totalHours, goal: row.goalPercent }))),
      importance: 0.95,
      classification: "hard_metric",
    },
  ];

  const lines: string[] = [];
  if (input.records.length === 0) {
    lines.push("No hours are logged yet — start clocking in (or run the shop kiosk) before asking for an engagement digest.");
  } else {
    lines.push(
      `${summary.totalHours}h logged by ${summary.activeMembers} of ${input.members.length} members (avg ${summary.avgHours ?? 0}h)${
        summary.hereNow ? `; ${summary.hereNow} in the shop right now` : ""
      }.`,
    );
    if (top.length) {
      lines.push(`Top contributors: ${top.map((row) => `${row.name ?? "Member"} (${row.totalHours}h)`).join(", ")}.`);
    }
    if (input.goalHours > 0) {
      lines.push(`${atGoal.length} member${atGoal.length === 1 ? " has" : "s have"} hit the ${input.goalHours}h season goal.`);
    }
    if (zeroHour.length) {
      lines.push(
        `${zeroHour.length} member${zeroHour.length === 1 ? " has" : "s have"} no logged hours${
          zeroHour.length <= 4 ? ` (${zeroHour.map((row) => row.name ?? "Member").join(", ")})` : ""
        } — check in with them before eligibility deadlines.`,
      );
    }
  }

  return {
    message: "Write a mentor's engagement digest from the shop-hours log: participation spread, top contributors, and who needs a check-in.",
    sources,
    localText: lines.join(" "),
  };
}

// ---------------------------------------------------------------------------
// Prediction accuracy — how well has the model called played matches?
// ---------------------------------------------------------------------------

export type PredictionOutcome = { matchKey: string; pRed: number; winner: "red" | "blue" };

export function buildModelAccuracyInsight(outcomes: PredictionOutcome[], pending: number): BuiltInsight {
  const scored = predictionAccuracy(outcomes);
  // Most-wrong call: confidence placed on the losing alliance.
  const wrongness = (outcome: PredictionOutcome) => (outcome.winner === "red" ? 1 - outcome.pRed : outcome.pRed);
  const worst = [...outcomes].sort((a, b) => wrongness(b) - wrongness(a))[0];

  const sources: InsightSource[] = [
    {
      type: "module_data",
      id: "predictions:accuracy",
      content: JSON.stringify({ ...scored, pending }),
      importance: 1,
      classification: "hard_metric",
    },
    ...outcomes.slice(0, 20).map((outcome) => ({
      type: "module_data" as const,
      id: `predictions:outcome:${outcome.matchKey}`,
      content: JSON.stringify(outcome),
      importance: 0.85,
      classification: "model_inference" as const,
    })),
  ];

  const lines: string[] = [];
  if (outcomes.length === 0) {
    lines.push(
      pending > 0
        ? `${pending} prediction${pending === 1 ? " is" : "s are"} stored but no predicted match has a result yet — accuracy appears once matches are played.`
        : "No predictions are stored yet — run Strategy on upcoming matches to start tracking model accuracy.",
    );
  } else {
    const accuracyPct = scored.accuracy == null ? null : Math.round(scored.accuracy * 100);
    lines.push(
      `The model has called ${scored.count} played match${scored.count === 1 ? "" : "es"}${
        accuracyPct != null ? ` at ${accuracyPct}% accuracy` : ""
      }${scored.brierScore != null ? ` (Brier ${scored.brierScore})` : ""}.`,
    );
    if (scored.brierScore != null) {
      lines.push(
        scored.brierScore <= 0.18
          ? "Calibration is sharp — trust the probabilities in close-match decisions."
          : scored.brierScore <= 0.25
            ? "Calibration is reasonable — treat mid-range probabilities as coin-flips."
            : "Calibration is noisy — feed more scouting data before leaning on the percentages.",
      );
    }
    if (worst && wrongness(worst) >= 0.6) {
      lines.push(
        `Biggest miss: ${worst.matchKey} — model gave red ${Math.round(worst.pRed * 100)}% and ${worst.winner} won. Debrief what the model could not see.`,
      );
    }
    if (pending > 0) lines.push(`${pending} prediction${pending === 1 ? "" : "s"} await results.`);
  }

  return {
    message: "Evaluate the match-prediction model against actual results: accuracy, calibration, and the biggest miss.",
    sources,
    localText: lines.join(" "),
  };
}

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

function requiredText(value: unknown, label: string, max: number) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required`);
  if (text.length > max) throw new Error(`${label} must be ${max} characters or fewer`);
  return text;
}

function uuid(value: unknown, label: string) {
  const text = requiredText(value, label, 64);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new Error(`${label} is invalid`);
  }
  return text;
}

export type InsightRequest = { orgId: string; kind: InsightKind; robotLabel: string };

export function parseInsightRequest(input: unknown): InsightRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid insight request");
  const body = input as Record<string, unknown>;
  const kind = requiredText(body.kind, "Insight kind", 40) as InsightKind;
  if (!INSIGHT_KINDS.includes(kind)) throw new Error("Unknown insight kind");
  const robotLabelRaw = body.robotLabel == null ? "" : String(body.robotLabel).trim();
  if (robotLabelRaw.length > 40) throw new Error("Robot label must be 40 characters or fewer");
  return { orgId: uuid(body.orgId, "Organization"), kind, robotLabel: robotLabelRaw || "competition" };
}
