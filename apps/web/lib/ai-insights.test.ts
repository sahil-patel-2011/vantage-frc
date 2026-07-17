import { describe, expect, it } from "vitest";
import {
  buildEngagementDigestInsight,
  buildInspectionAdvisorInsight,
  buildKickoffStrategistInsight,
  buildModelAccuracyInsight,
  buildPracticeCoachInsight,
  buildScheduleRiskInsight,
  buildStockAdvisorInsight,
  buildVideoScoutSummaryInsight,
  INSIGHT_CAPABILITY,
  parseInsightRequest,
} from "./ai-insights";
import type { DriverSession } from "./driver-practice";
import type { InspectionItem, RobotWeight } from "./inspection";
import type { BomEntry, InventoryItem } from "./inventory";
import type { DesignPriority, ScoringAction } from "./kickoff";
import type { Milestone } from "./season-calendar";
import type { VideoReview } from "./video-review";

const ORG = "11111111-1111-4111-8111-111111111111";

function session(id: string, cycles: Array<{ action: string; seconds: number | null; success: boolean }>): DriverSession {
  return {
    id,
    title: `Session ${id}`,
    eventKey: null,
    sessionDate: "2026-02-01",
    driverUserId: null,
    driverName: "Ada",
    location: "",
    goal: "",
    notes: "",
    attendanceEventId: null,
    attendanceEventTitle: null,
    buildTaskId: null,
    buildTaskTitle: null,
    createdAt: "2026-02-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
    cycles: cycles.map((cycle, index) => ({
      id: `${id}-${index}`,
      sessionId: id,
      action: cycle.action,
      seconds: cycle.seconds,
      success: cycle.success,
      note: "",
      repIndex: index,
      createdAt: "2026-02-01T00:00:00.000Z",
    })),
  };
}

describe("buildPracticeCoachInsight", () => {
  it("handles an empty log honestly", () => {
    const built = buildPracticeCoachInsight([]);
    expect(built.localText).toMatch(/No practice reps/);
    expect(built.sources.length).toBeGreaterThan(0); // overall stats source always present
  });
  it("flags the weakest action and provides provenance sources", () => {
    const built = buildPracticeCoachInsight([
      session("a", [
        { action: "Score high", seconds: 5, success: false },
        { action: "Score high", seconds: 6, success: false },
        { action: "Score high", seconds: 7, success: true },
        { action: "Intake", seconds: 2, success: true },
        { action: "Intake", seconds: 2, success: true },
        { action: "Intake", seconds: 2, success: true },
      ]),
    ]);
    expect(built.localText).toMatch(/Priority drill: "Score high"/);
    expect(built.localText).toMatch(/"Intake" is match-ready/);
    expect(built.sources.some((source) => source.classification === "hard_metric")).toBe(true);
  });
  it("reports a cycle-time trend across sessions (latest first)", () => {
    const built = buildPracticeCoachInsight([
      session("latest", [
        { action: "Full cycle", seconds: 5, success: true },
        { action: "Full cycle", seconds: 5, success: true },
      ]),
      session("older", [
        { action: "Full cycle", seconds: 8, success: true },
        { action: "Full cycle", seconds: 8, success: true },
      ]),
    ]);
    expect(built.localText).toMatch(/improved 3s/);
  });
});

function inspectionItem(overrides: Partial<InspectionItem>): InspectionItem {
  return {
    id: Math.random().toString(36).slice(2),
    robotLabel: "competition",
    category: "Electrical",
    requirement: "Battery secure",
    status: "pending",
    note: "",
    isCustom: false,
    sortOrder: 0,
    checkedByName: null,
    checkedAt: null,
    ...overrides,
  };
}

const weight = (lbs: number): RobotWeight => ({
  id: "w",
  robotLabel: "competition",
  totalLbs: lbs,
  config: "",
  note: "",
  weighedAt: "2026-03-01T00:00:00.000Z",
  recordedByName: null,
});

describe("buildInspectionAdvisorInsight", () => {
  it("prioritizes overweight above everything", () => {
    const built = buildInspectionAdvisorInsight({
      items: [inspectionItem({ status: "pass" })],
      weights: [weight(130)],
      weightLimitLbs: 125,
      robotLabel: "competition",
    });
    expect(built.localText).toMatch(/URGENT: latest weigh-in is 5 lb over/);
  });
  it("lists failing items and open categories", () => {
    const built = buildInspectionAdvisorInsight({
      items: [
        inspectionItem({ status: "fail", requirement: "Main breaker accessible", note: "buried" }),
        inspectionItem({ status: "pending", category: "Pneumatics", requirement: "Relief valve set" }),
      ],
      weights: [],
      weightLimitLbs: 125,
      robotLabel: "competition",
    });
    expect(built.localText).toMatch(/Fix the failing item/);
    expect(built.localText).toMatch(/Main breaker accessible \(buried\)/);
    expect(built.localText).toMatch(/Pneumatics \(1\)/);
    expect(built.localText).toMatch(/No weigh-in is logged/);
  });
  it("celebrates a ready robot", () => {
    const built = buildInspectionAdvisorInsight({
      items: [inspectionItem({ status: "pass" })],
      weights: [weight(120)],
      weightLimitLbs: 125,
      robotLabel: "competition",
    });
    expect(built.localText).toMatch(/Everything passes/);
  });
});

function stockItem(overrides: Partial<InventoryItem>): InventoryItem {
  return {
    id: Math.random().toString(36).slice(2),
    name: "NEO",
    category: "motor",
    partNumber: null,
    vendor: null,
    unit: "each",
    quantity: 4,
    minQuantity: 0,
    unitCost: null,
    locationId: null,
    locationName: null,
    subsystem: null,
    notes: "",
    archived: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildStockAdvisorInsight", () => {
  it("reports healthy stock", () => {
    const built = buildStockAdvisorInsight({ items: [stockItem({})], bom: [] });
    expect(built.localText).toMatch(/Stock is healthy/);
  });
  it("suggests reorder quantities to 2x threshold with cost, and BOM blockers", () => {
    const itemId = "22222222-2222-4222-8222-222222222222";
    const bom: BomEntry[] = [{ id: "b", subsystem: "Drivetrain", itemId, quantityNeeded: 6, notes: "" }];
    const built = buildStockAdvisorInsight({
      items: [stockItem({ id: itemId, name: "Falcon", quantity: 1, minQuantity: 2, unitCost: 100 })],
      bom,
    });
    // needed = 2*2 - 1 = 3, cost 300
    expect(built.localText).toMatch(/Falcon \(have 1, order ~3 ≈ \$300\)/);
    expect(built.localText).toMatch(/Drivetrain \(1 part short\)/);
    expect(built.localText).toMatch(/~\$300/);
  });
});

function scoringAction(overrides: Partial<ScoringAction>): ScoringAction {
  return {
    id: Math.random().toString(36).slice(2),
    seasonYear: 2026,
    label: "Score high",
    phase: "teleop",
    points: 5,
    estSeconds: 5,
    notes: "",
    sortOrder: 0,
    ...overrides,
  };
}

describe("buildKickoffStrategistInsight", () => {
  it("prompts when the scoring table is empty", () => {
    const built = buildKickoffStrategistInsight({ actions: [], priorities: [], seasonYear: 2026 });
    expect(built.localText).toMatch(/No scoring actions/);
  });
  it("ranks value, flags endgame share, and finds coverage gaps", () => {
    const climb = scoringAction({ id: "11111111-1111-4111-8111-111111111111", label: "Climb", phase: "endgame", points: 12, estSeconds: 10 });
    const high = scoringAction({ id: "22222222-2222-4222-8222-222222222222", label: "Score high", points: 6, estSeconds: 4 });
    const priorities: DesignPriority[] = [
      { id: "p1", seasonYear: 2026, capability: "Fast high scoring", rationale: "", weight: 5, status: "committed", linkedActionId: high.id },
    ];
    const built = buildKickoffStrategistInsight({ actions: [climb, high], priorities, seasonYear: 2026 });
    expect(built.localText).toMatch(/Top value actions/);
    expect(built.localText).toMatch(/Endgame carries 67%/);
    expect(built.localText).toMatch(/Committed capabilities: Fast high scoring/);
    expect(built.localText).toMatch(/Coverage gap: "Climb"/);
  });
});

function milestone(overrides: Partial<Milestone>): Milestone {
  return {
    id: Math.random().toString(36).slice(2),
    title: "Design freeze",
    kind: "design",
    startsOn: "2026-01-20",
    endsOn: null,
    notes: "",
    done: false,
    doneAt: null,
    doneByName: null,
    createdByName: null,
    ...overrides,
  };
}

describe("buildScheduleRiskInsight", () => {
  const NOW = new Date("2026-02-01T12:00:00.000Z").getTime();
  it("flags overdue items and event risk", () => {
    const built = buildScheduleRiskInsight(
      [
        milestone({ title: "Design freeze", startsOn: "2026-01-25" }),
        milestone({ title: "Week 1 Regional", kind: "event", startsOn: "2026-02-10" }),
        milestone({ title: "Drivetrain rolling", startsOn: "2026-01-10", done: true }),
      ],
      NOW,
    );
    expect(built.localText).toMatch(/1 milestone is overdue: Design freeze \(7d late\)/);
    expect(built.localText).toMatch(/"Week 1 Regional" is in 9 days with 1 overdue prerequisite/);
  });
  it("reports a healthy plan", () => {
    const built = buildScheduleRiskInsight([milestone({ startsOn: "2026-02-20" })], NOW);
    expect(built.localText).toMatch(/No overdue milestones/);
  });
  it("prompts when empty", () => {
    expect(buildScheduleRiskInsight([], NOW).localText).toMatch(/seed the build-season template/i);
  });
});

function review(title: string, notes: Array<{ tag: VideoReview["notes"][number]["tag"]; at: number; body: string }>): VideoReview {
  return {
    id: Math.random().toString(36).slice(2),
    title,
    url: "https://youtu.be/abc12345",
    videoId: "abc12345",
    matchKey: null,
    teamKey: null,
    summary: "",
    createdByName: null,
    updatedAt: "2026-03-01T00:00:00.000Z",
    notes: notes.map((note, index) => ({
      id: `${title}-${index}`,
      reviewId: title,
      atSeconds: note.at,
      tag: note.tag,
      body: note.body,
      createdByName: null,
      createdAt: "2026-03-01T00:00:00.000Z",
    })),
  };
}

describe("buildVideoScoutSummaryInsight", () => {
  it("prompts when no notes exist", () => {
    expect(buildVideoScoutSummaryInsight([review("Q1", [])]).localText).toMatch(/No timestamped video notes/);
  });
  it("summarizes tags, failures with timestamps, and the deepest review", () => {
    const built = buildVideoScoutSummaryInsight([
      review("Q42 vs 254", [
        { tag: "failure", at: 83, body: "intake jam" },
        { tag: "defense", at: 130, body: "pinned in corner" },
        { tag: "auto", at: 5, body: "3-piece auto" },
      ]),
      review("Q50", [{ tag: "failure", at: 30, body: "dropped climb" }]),
    ]);
    expect(built.localText).toMatch(/4 timestamped notes across 2 reviews/);
    expect(built.localText).toMatch(/Q42 vs 254 @ 1:23: intake jam/);
    expect(built.localText).toMatch(/pinned in corner/);
    expect(built.localText).toMatch(/Deepest review: "Q42 vs 254" \(3 notes\)/);
  });
});

describe("buildEngagementDigestInsight", () => {
  const NOW = new Date("2026-02-01T20:00:00.000Z").getTime();
  const members = [
    { userId: "u1", name: "Ada", role: "scout" },
    { userId: "u2", name: "Grace", role: "admin" },
  ];
  const log = (userId: string, name: string): import("./build-hours").HourLog => ({
    id: `${userId}-log`,
    userId,
    userName: name,
    kind: "build",
    clockIn: "2026-02-01T17:00:00.000Z",
    clockOut: "2026-02-01T19:00:00.000Z",
    note: "",
    closedByName: null,
  });
  it("prompts when empty", () => {
    expect(buildEngagementDigestInsight({ records: [], members, goalHours: 0 }, NOW).localText).toMatch(/No hours are logged/);
  });
  it("reports participation, top contributors, and zero-hour members", () => {
    const built = buildEngagementDigestInsight({ records: [log("u1", "Ada")], members, goalHours: 2 }, NOW);
    expect(built.localText).toMatch(/2h logged by 1 of 2 members/);
    expect(built.localText).toMatch(/Top contributors: Ada \(2h\)/);
    expect(built.localText).toMatch(/1 member has hit the 2h season goal/);
    expect(built.localText).toMatch(/1 member has no logged hours \(Grace\)/);
  });
});

describe("buildModelAccuracyInsight", () => {
  it("handles no data and pending-only states", () => {
    expect(buildModelAccuracyInsight([], 0).localText).toMatch(/No predictions are stored/);
    expect(buildModelAccuracyInsight([], 3).localText).toMatch(/3 predictions are stored but no predicted match has a result/);
  });
  it("reports accuracy, calibration, and the biggest miss", () => {
    const built = buildModelAccuracyInsight(
      [
        { matchKey: "2026onto_qm1", pRed: 0.8, winner: "red" }, // right
        { matchKey: "2026onto_qm2", pRed: 0.7, winner: "blue" }, // wrong, wrongness .7
        { matchKey: "2026onto_qm3", pRed: 0.4, winner: "blue" }, // right
      ],
      1,
    );
    expect(built.localText).toMatch(/called 3 played matches at 67% accuracy/);
    expect(built.localText).toMatch(/Biggest miss: 2026onto_qm2 — model gave red 70% and blue won/);
    expect(built.localText).toMatch(/1 prediction awaits results/);
    expect(built.sources.some((source) => source.classification === "model_inference")).toBe(true);
  });
});

describe("parseInsightRequest + capability map", () => {
  it("validates kind and defaults robot label", () => {
    expect(parseInsightRequest({ orgId: ORG, kind: "practice_coach" })).toEqual({
      orgId: ORG,
      kind: "practice_coach",
      robotLabel: "competition",
    });
    expect(parseInsightRequest({ orgId: ORG, kind: "inspection_advisor", robotLabel: "practice" }).robotLabel).toBe("practice");
    expect(() => parseInsightRequest({ orgId: ORG, kind: "fortune_teller" })).toThrow(/Unknown insight kind/);
    expect(() => parseInsightRequest({ orgId: "nope", kind: "practice_coach" })).toThrow(/invalid/i);
  });
  it("maps every kind to an orchestrator capability", () => {
    expect(INSIGHT_CAPABILITY.practice_coach).toBe("strategy");
    expect(INSIGHT_CAPABILITY.inspection_advisor).toBe("maintenance");
    expect(INSIGHT_CAPABILITY.stock_advisor).toBe("maintenance");
    expect(INSIGHT_CAPABILITY.kickoff_strategist).toBe("strategy");
    expect(INSIGHT_CAPABILITY.schedule_risk).toBe("strategy");
    expect(INSIGHT_CAPABILITY.video_scout_summary).toBe("team_intel");
    expect(INSIGHT_CAPABILITY.engagement_digest).toBe("team_intel");
    expect(INSIGHT_CAPABILITY.model_accuracy).toBe("prediction");
  });
});
