import { describe, expect, it } from "vitest";
import {
  KANBAN_STATES,
  MIN_COMPLETED_FOR_CYCLE_TIME,
  advanceLabel,
  advanceTarget,
  allowedTransitions,
  atRiskParts,
  cycleTimeByState,
  groupByState,
  isAllowedTransition,
  partsMissingDueDate,
  subsystemCoverage,
} from ".";
import type {
  ManufacturingPart,
  ManufacturingState,
  ManufacturingStateEvent,
  SubsystemOption,
} from "./types";

function part(overrides: Partial<ManufacturingPart> & { id: string }): ManufacturingPart {
  return {
    seasonYear: 2026,
    partName: `Part ${overrides.id}`,
    quantity: 1,
    method: "mill",
    state: "needs_design",
    priority: "normal",
    subsystemId: null,
    subsystemName: null,
    bomEntryId: null,
    inventoryItemId: null,
    buildTaskId: null,
    material: null,
    stockNote: null,
    neededBy: null,
    assignedTo: null,
    assignedName: null,
    requestedBy: "u1",
    scrapReason: null,
    reprintOfId: null,
    createdAt: "2026-01-10T00:00:00.000Z",
    updatedAt: "2026-01-10T00:00:00.000Z",
    ...overrides,
  };
}

function event(
  partId: string,
  fromState: ManufacturingState | null,
  toState: ManufacturingState,
  createdAt: string,
): ManufacturingStateEvent {
  return { id: `${partId}-${toState}-${createdAt}`, partId, fromState, toState, note: null, createdAt };
}

describe("allowedTransitions state machine", () => {
  it("covers every kanban state", () => {
    for (const state of KANBAN_STATES) {
      expect(Array.isArray(allowedTransitions(state))).toBe(true);
    }
  });

  it("never allows a state to transition to itself", () => {
    for (const state of KANBAN_STATES) {
      expect(allowedTransitions(state)).not.toContain(state);
    }
  });

  it("refuses free movement: needs_design cannot jump straight to done", () => {
    expect(isAllowedTransition("needs_design", "done")).toBe(false);
    expect(isAllowedTransition("needs_cam", "done")).toBe(false);
    expect(isAllowedTransition("ready_to_cut", "done")).toBe(false);
  });

  it("allows the forward path needs_design -> ... -> done", () => {
    expect(isAllowedTransition("needs_design", "needs_cam")).toBe(true);
    expect(isAllowedTransition("needs_cam", "ready_to_cut")).toBe(true);
    expect(isAllowedTransition("ready_to_cut", "in_progress")).toBe(true);
    expect(isAllowedTransition("in_progress", "needs_finishing")).toBe(true);
    expect(isAllowedTransition("needs_finishing", "done")).toBe(true);
  });

  it("allows scrapping from every active state but not from scrapped", () => {
    for (const state of KANBAN_STATES) {
      if (state === "scrapped") continue;
      expect(isAllowedTransition(state, "scrapped")).toBe(true);
    }
    expect(isAllowedTransition("scrapped", "scrapped")).toBe(false);
  });

  it("reopens scrapped parts only into early working states", () => {
    expect(isAllowedTransition("scrapped", "needs_design")).toBe(true);
    expect(isAllowedTransition("scrapped", "done")).toBe(false);
    expect(isAllowedTransition("scrapped", "in_progress")).toBe(false);
  });

  it("advanceTarget walks the happy path and is null for terminal states", () => {
    expect(advanceTarget("needs_design")).toBe("needs_cam");
    expect(advanceTarget("needs_finishing")).toBe("done");
    expect(advanceTarget("done")).toBeNull();
    expect(advanceTarget("scrapped")).toBeNull();
  });

  it("every advance target is a legal transition with a label", () => {
    for (const state of KANBAN_STATES) {
      const target = advanceTarget(state);
      if (target) {
        expect(isAllowedTransition(state, target)).toBe(true);
        expect(advanceLabel(state)).toBeTruthy();
      } else {
        expect(advanceLabel(state)).toBeNull();
      }
    }
  });
});

describe("groupByState", () => {
  it("returns a bucket for every state even when empty", () => {
    const groups = groupByState([]);
    expect([...groups.keys()]).toEqual(KANBAN_STATES);
    for (const bucket of groups.values()) expect(bucket).toEqual([]);
  });

  it("sorts within a column by priority then needed-by, dated parts before undated", () => {
    const groups = groupByState([
      part({ id: "a", state: "needs_cam", priority: "low", neededBy: "2026-01-01" }),
      part({ id: "b", state: "needs_cam", priority: "critical", neededBy: null }),
      part({ id: "c", state: "needs_cam", priority: "critical", neededBy: "2026-02-01" }),
      part({ id: "d", state: "needs_cam", priority: "critical", neededBy: "2026-01-15" }),
    ]);
    expect((groups.get("needs_cam") ?? []).map((p) => p.id)).toEqual(["d", "c", "b", "a"]);
  });
});

describe("atRiskParts / partsMissingDueDate honesty", () => {
  const parts = [
    part({ id: "overdue", state: "in_progress", neededBy: "2026-01-01" }),
    part({ id: "overdue-done", state: "done", neededBy: "2026-01-01" }),
    part({ id: "overdue-scrapped", state: "scrapped", neededBy: "2026-01-01" }),
    part({ id: "future", state: "in_progress", neededBy: "2026-12-01" }),
    part({ id: "undated", state: "needs_cam", neededBy: null }),
    part({ id: "undated-done", state: "done", neededBy: null }),
  ];

  it("only flags open parts past their needed-by date", () => {
    expect(atRiskParts({ parts, today: "2026-02-01" }).map((p) => p.id)).toEqual(["overdue"]);
  });

  it("a part due today is not yet at risk", () => {
    expect(atRiskParts({ parts, today: "2026-01-01" })).toEqual([]);
  });

  it("never defaults a missing needed-by onto the risk strip; flags it separately", () => {
    const risk = atRiskParts({ parts, today: "2026-02-01" });
    expect(risk.some((p) => p.neededBy == null)).toBe(false);
    expect(partsMissingDueDate(parts).map((p) => p.id)).toEqual(["undated"]);
  });

  it("sorts most overdue first", () => {
    const list = [
      part({ id: "late", state: "needs_cam", neededBy: "2026-01-20" }),
      part({ id: "later", state: "needs_cam", neededBy: "2026-01-05" }),
    ];
    expect(atRiskParts({ parts: list, today: "2026-02-01" }).map((p) => p.id)).toEqual(["later", "late"]);
  });
});

describe("cycleTimeByState honesty threshold", () => {
  function completedPartEvents(partId: string, startIso: string): ManufacturingStateEvent[] {
    const start = Date.parse(startIso);
    const at = (hours: number) => new Date(start + hours * 3600_000).toISOString();
    return [
      event(partId, null, "needs_design", at(0)),
      event(partId, "needs_design", "needs_cam", at(2)),
      event(partId, "needs_cam", "ready_to_cut", at(4)),
      event(partId, "ready_to_cut", "in_progress", at(6)),
      event(partId, "in_progress", "done", at(10)),
    ];
  }

  it("returns null with zero events", () => {
    expect(cycleTimeByState([])).toBeNull();
  });

  it("returns null below the completed-parts threshold — never an estimate", () => {
    const events: ManufacturingStateEvent[] = [];
    for (let i = 0; i < MIN_COMPLETED_FOR_CYCLE_TIME - 1; i += 1) {
      events.push(...completedPartEvents(`p${i}`, "2026-01-10T00:00:00.000Z"));
    }
    // An in-flight part does not count toward the threshold.
    events.push(event("open", null, "needs_design", "2026-01-10T00:00:00.000Z"));
    events.push(event("open", "needs_design", "needs_cam", "2026-01-11T00:00:00.000Z"));
    expect(cycleTimeByState(events)).toBeNull();
  });

  it("averages dwell hours per state once enough parts finished", () => {
    const events: ManufacturingStateEvent[] = [];
    for (let i = 0; i < MIN_COMPLETED_FOR_CYCLE_TIME; i += 1) {
      events.push(...completedPartEvents(`p${i}`, "2026-01-10T00:00:00.000Z"));
    }
    const summary = cycleTimeByState(events);
    expect(summary).not.toBeNull();
    expect(summary?.completedParts).toBe(MIN_COMPLETED_FOR_CYCLE_TIME);
    const byState = Object.fromEntries((summary?.byState ?? []).map((row) => [row.state, row.avgHours]));
    expect(byState.needs_design).toBe(2);
    expect(byState.needs_cam).toBe(2);
    expect(byState.ready_to_cut).toBe(2);
    expect(byState.in_progress).toBe(4);
    // Terminal states carry no dwell rows.
    expect(byState.done).toBeUndefined();
  });
});

describe("subsystemCoverage", () => {
  const subsystems: SubsystemOption[] = [
    { id: "s1", name: "Drivetrain", seasonYear: 2026 },
    { id: "s2", name: "Intake", seasonYear: 2026 },
  ];

  it("returns empty for no parts (no fabricated rows)", () => {
    expect(subsystemCoverage([], subsystems)).toEqual([]);
  });

  it("counts total, done, and active per subsystem plus an Unassigned row", () => {
    const rows = subsystemCoverage(
      [
        part({ id: "a", subsystemId: "s1", state: "done" }),
        part({ id: "b", subsystemId: "s1", state: "in_progress" }),
        part({ id: "c", subsystemId: "s1", state: "scrapped" }),
        part({ id: "d", subsystemId: null, state: "needs_cam" }),
      ],
      subsystems,
    );
    const drivetrain = rows.find((row) => row.subsystemId === "s1");
    expect(drivetrain).toEqual({ subsystemId: "s1", subsystemName: "Drivetrain", total: 3, done: 1, active: 1 });
    const unassigned = rows.find((row) => row.subsystemId === null);
    expect(unassigned?.total).toBe(1);
    // Intake has no parts: no row, not a zero-filled placeholder.
    expect(rows.some((row) => row.subsystemId === "s2")).toBe(false);
  });
});
