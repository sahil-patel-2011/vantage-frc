import { describe, expect, it } from "vitest";
import {
  kickoffSummary,
  parseKickoffAction,
  pointsPerSecond,
  rankActions,
  type DesignPriority,
  type RuleNote,
  type ScoringAction,
} from "./kickoff";

const ORG = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";
const LINKED = "33333333-3333-4333-8333-333333333333";

function action(overrides: Partial<ScoringAction>): ScoringAction {
  return {
    id: "a1",
    seasonYear: 2026,
    label: "Score game piece",
    phase: "teleop",
    points: 5,
    estSeconds: null,
    notes: "",
    sortOrder: 0,
    ...overrides,
  };
}

function priority(overrides: Partial<DesignPriority>): DesignPriority {
  return {
    id: "p1",
    seasonYear: 2026,
    capability: "Fast ground intake",
    rationale: "",
    weight: 3,
    status: "proposed",
    linkedActionId: null,
    ...overrides,
  };
}

function note(overrides: Partial<RuleNote>): RuleNote {
  return {
    id: "n1",
    seasonYear: 2026,
    question: "Can robots extend beyond the frame perimeter in auto?",
    answer: "",
    ruleRef: "",
    status: "open",
    ...overrides,
  };
}

describe("pointsPerSecond", () => {
  it("divides points by estimated seconds and rounds to two decimals", () => {
    expect(pointsPerSecond(action({ points: 4, estSeconds: 3 }))).toBe(1.33);
    expect(pointsPerSecond(action({ points: 2, estSeconds: 3 }))).toBe(0.67);
    expect(pointsPerSecond(action({ points: 5, estSeconds: 2 }))).toBe(2.5);
  });
  it("returns null without a positive cycle estimate", () => {
    expect(pointsPerSecond(action({ points: 7, estSeconds: null }))).toBeNull();
    expect(pointsPerSecond(action({ points: 7, estSeconds: 0 }))).toBeNull();
  });
});

describe("rankActions", () => {
  it("puts the best pts/sec first and unestimated actions last by raw points", () => {
    const ranked = rankActions([
      action({ id: "slow", points: 4, estSeconds: 8 }),
      action({ id: "untimed-low", points: 3, estSeconds: null }),
      action({ id: "fast", points: 6, estSeconds: 3 }),
      action({ id: "untimed-high", points: 10, estSeconds: null }),
    ]);
    expect(ranked.map((entry) => entry.id)).toEqual(["fast", "slow", "untimed-high", "untimed-low"]);
  });
  it("breaks pts/sec ties by raw points", () => {
    const ranked = rankActions([
      action({ id: "small", points: 4, estSeconds: 2 }),
      action({ id: "big", points: 8, estSeconds: 4 }),
    ]);
    expect(ranked.map((entry) => entry.id)).toEqual(["big", "small"]);
  });
  it("returns a sorted copy without mutating the input", () => {
    const input = [action({ id: "x", points: 1, estSeconds: 10 }), action({ id: "y", points: 9, estSeconds: 3 })];
    rankActions(input);
    expect(input.map((entry) => entry.id)).toEqual(["x", "y"]);
  });
});

describe("kickoffSummary", () => {
  it("counts actions, committed priorities, and open questions and picks the best action", () => {
    const summary = kickoffSummary(
      [action({ id: "a", label: "Long climb", points: 12, estSeconds: 15 }), action({ id: "b", label: "Quick cycle", points: 4, estSeconds: 2 })],
      [priority({ id: "p1", status: "committed" }), priority({ id: "p2", status: "proposed" }), priority({ id: "p3", status: "committed" })],
      [note({ id: "n1", status: "open" }), note({ id: "n2", status: "answered" }), note({ id: "n3", status: "open" })],
    );
    expect(summary).toEqual({ actions: 2, bestAction: "Quick cycle", committed: 2, openQuestions: 2 });
  });
  it("reports a null best action when nothing has a time estimate", () => {
    expect(kickoffSummary([action({ estSeconds: null })], [], []).bestAction).toBeNull();
    expect(kickoffSummary([], [], []).bestAction).toBeNull();
  });
});

describe("parseKickoffAction", () => {
  it("parses add_action with phase, seconds, and notes defaults", () => {
    expect(parseKickoffAction({ action: "add_action", orgId: ORG, seasonYear: 2026, label: "Score high goal", points: 3 })).toEqual({
      action: "add_action",
      orgId: ORG,
      seasonYear: 2026,
      label: "Score high goal",
      phase: "teleop",
      points: 3,
      estSeconds: null,
      notes: "",
    });
  });
  it("rounds points and seconds to one decimal", () => {
    expect(
      parseKickoffAction({ action: "add_action", orgId: ORG, seasonYear: 2026, label: "x", phase: "auto", points: 3.14, estSeconds: 4.25 }),
    ).toMatchObject({ phase: "auto", points: 3.1, estSeconds: 4.3 });
  });
  it("parses sparse update_action patches, including clearing the estimate", () => {
    expect(parseKickoffAction({ action: "update_action", orgId: ORG, id: ID, label: "Renamed", estSeconds: null })).toEqual({
      action: "update_action",
      orgId: ORG,
      id: ID,
      patch: { label: "Renamed", estSeconds: null },
    });
    expect(parseKickoffAction({ action: "update_action", orgId: ORG, id: ID, sortOrder: 4 })).toMatchObject({ patch: { sortOrder: 4 } });
  });
  it("parses add_priority with a weight default and optional linked action", () => {
    expect(parseKickoffAction({ action: "add_priority", orgId: ORG, seasonYear: 2026, capability: "Climb every match" })).toMatchObject({
      weight: 3,
      rationale: "",
      linkedActionId: null,
    });
    expect(
      parseKickoffAction({ action: "add_priority", orgId: ORG, seasonYear: 2026, capability: "x", weight: 5, linkedActionId: LINKED }),
    ).toMatchObject({ weight: 5, linkedActionId: LINKED });
  });
  it("parses update_priority status changes", () => {
    expect(parseKickoffAction({ action: "update_priority", orgId: ORG, id: ID, status: "committed", weight: 4 })).toEqual({
      action: "update_priority",
      orgId: ORG,
      id: ID,
      patch: { status: "committed", weight: 4 },
    });
  });
  it("parses rule note add and update actions", () => {
    expect(parseKickoffAction({ action: "add_rule_note", orgId: ORG, seasonYear: 2026, question: "Is pinning legal?" })).toMatchObject({
      question: "Is pinning legal?",
      ruleRef: "",
    });
    expect(
      parseKickoffAction({ action: "update_rule_note", orgId: ORG, id: ID, answer: "Only for 5 seconds.", status: "answered" }),
    ).toMatchObject({ patch: { answer: "Only for 5 seconds.", status: "answered" } });
  });
  it("rejects an out-of-range season year", () => {
    expect(() => parseKickoffAction({ action: "add_action", orgId: ORG, seasonYear: 1980, label: "x", points: 1 })).toThrow(/Season year/);
    expect(() => parseKickoffAction({ action: "add_rule_note", orgId: ORG, seasonYear: 2101, question: "x" })).toThrow(/Season year/);
  });
  it("rejects an out-of-range weight", () => {
    expect(() => parseKickoffAction({ action: "add_priority", orgId: ORG, seasonYear: 2026, capability: "x", weight: 9 })).toThrow(/Weight/);
    expect(() => parseKickoffAction({ action: "update_priority", orgId: ORG, id: ID, weight: 2.5 })).toThrow(/Weight/);
  });
  it("rejects an unknown phase", () => {
    expect(() =>
      parseKickoffAction({ action: "add_action", orgId: ORG, seasonYear: 2026, label: "x", points: 1, phase: "hyperdrive" }),
    ).toThrow(/Invalid phase/);
  });
  it("rejects out-of-range points and seconds", () => {
    expect(() => parseKickoffAction({ action: "add_action", orgId: ORG, seasonYear: 2026, label: "x", points: 1001 })).toThrow(/Points/);
    expect(() =>
      parseKickoffAction({ action: "add_action", orgId: ORG, seasonYear: 2026, label: "x", points: 1, estSeconds: 601 }),
    ).toThrow(/seconds/);
  });
  it("rejects empty patches", () => {
    expect(() => parseKickoffAction({ action: "update_action", orgId: ORG, id: ID })).toThrow(/No changes provided/);
    expect(() => parseKickoffAction({ action: "update_priority", orgId: ORG, id: ID })).toThrow(/No changes provided/);
    expect(() => parseKickoffAction({ action: "update_rule_note", orgId: ORG, id: ID })).toThrow(/No changes provided/);
  });
  it("rejects malformed uuids", () => {
    expect(() => parseKickoffAction({ action: "delete_action", orgId: "not-a-uuid", id: ID })).toThrow(/Organization is invalid/);
    expect(() => parseKickoffAction({ action: "delete_priority", orgId: ORG, id: "nope" })).toThrow(/invalid/);
    expect(() =>
      parseKickoffAction({ action: "add_priority", orgId: ORG, seasonYear: 2026, capability: "x", linkedActionId: "bad" }),
    ).toThrow(/Linked action is invalid/);
  });
  it("rejects unsupported actions", () => {
    expect(() => parseKickoffAction({ action: "vanish", orgId: ORG })).toThrow(/Unsupported kickoff action/);
    expect(() => parseKickoffAction(null)).toThrow(/Invalid kickoff action/);
  });
});
