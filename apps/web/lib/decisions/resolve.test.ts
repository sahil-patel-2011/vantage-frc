import { describe, expect, it } from "vitest";
import { resolveSupersession, summarizeDecisions } from "./resolve";
import type { DecisionCategory, DecisionRecord, DecisionStatus } from "./types";

let seq = 0;
function decision(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  seq += 1;
  return {
    id: `d-${seq}`,
    title: `Decision ${seq}`,
    category: "design" as DecisionCategory,
    status: "accepted" as DecisionStatus,
    context: null,
    decision: null,
    rationale: null,
    options: [],
    decidedOn: "2026-02-01",
    deciders: null,
    supersedesId: null,
    notes: null,
    seasonYear: 2026,
    createdAt: `2026-02-01T00:00:0${seq}.000Z`,
    ...overrides,
  };
}

describe("resolveSupersession", () => {
  it("marks an accepted decision superseded by a later accepted one", () => {
    const first = decision({ id: "v1", title: "Tank drive", status: "accepted", decidedOn: "2026-01-10" });
    const second = decision({
      id: "v2",
      title: "Swerve drive",
      status: "accepted",
      decidedOn: "2026-02-10",
      supersedesId: "v1",
    });
    const resolved = resolveSupersession([first, second]);
    const r1 = resolved.find((r) => r.id === "v1");
    const r2 = resolved.find((r) => r.id === "v2");
    expect(r1?.effectiveStatus).toBe("superseded");
    expect(r1?.supersededById).toBe("v2");
    expect(r1?.supersededByTitle).toBe("Swerve drive");
    expect(r2?.effectiveStatus).toBe("accepted");
  });

  it("does not supersede when the replacing decision is not accepted", () => {
    const first = decision({ id: "v1", status: "accepted" });
    const proposal = decision({ id: "v2", status: "proposed", supersedesId: "v1" });
    const resolved = resolveSupersession([first, proposal]);
    expect(resolved.find((r) => r.id === "v1")?.effectiveStatus).toBe("accepted");
  });

  it("keeps the latest superseder when several replace the same decision", () => {
    const base = decision({ id: "base", status: "accepted", decidedOn: "2026-01-01" });
    const mid = decision({ id: "mid", status: "accepted", decidedOn: "2026-02-01", supersedesId: "base" });
    const late = decision({ id: "late", status: "accepted", decidedOn: "2026-03-01", supersedesId: "base" });
    const resolved = resolveSupersession([base, mid, late]);
    expect(resolved.find((r) => r.id === "base")?.supersededById).toBe("late");
  });

  it("ignores supersedesId that points at a missing record", () => {
    const orphan = decision({ id: "v2", status: "accepted", supersedesId: "ghost" });
    const resolved = resolveSupersession([orphan]);
    expect(resolved[0]?.effectiveStatus).toBe("accepted");
  });

  it("respects an explicitly recorded superseded status", () => {
    const resolved = resolveSupersession([decision({ id: "x", status: "superseded" })]);
    expect(resolved[0]?.effectiveStatus).toBe("superseded");
  });
});

describe("summarizeDecisions", () => {
  it("is all-zero for no records", () => {
    const s = summarizeDecisions([]);
    expect(s.total).toBe(0);
    expect(s.open).toEqual([]);
    expect(s.recent).toEqual([]);
    expect(s.supersededCount).toBe(0);
  });

  it("counts by effective status (superseded reflected)", () => {
    const s = summarizeDecisions([
      decision({ id: "v1", status: "accepted", decidedOn: "2026-01-10" }),
      decision({ id: "v2", status: "accepted", decidedOn: "2026-02-10", supersedesId: "v1" }),
      decision({ id: "p", status: "proposed" }),
    ]);
    expect(s.byStatus.accepted).toBe(1); // v2
    expect(s.byStatus.superseded).toBe(1); // v1
    expect(s.byStatus.proposed).toBe(1);
    expect(s.supersededCount).toBe(1);
  });

  it("surfaces open (proposed) decisions oldest-first", () => {
    const s = summarizeDecisions([
      decision({ id: "new", status: "proposed", createdAt: "2026-03-01T00:00:00Z" }),
      decision({ id: "old", status: "proposed", createdAt: "2026-01-01T00:00:00Z" }),
    ]);
    expect(s.open.map((d) => d.id)).toEqual(["old", "new"]);
  });

  it("orders recent decided newest-first and rolls up by category", () => {
    const s = summarizeDecisions([
      decision({ id: "a", category: "design", status: "accepted", decidedOn: "2026-02-20" }),
      decision({ id: "b", category: "design", status: "rejected", decidedOn: "2026-03-05" }),
      decision({ id: "c", category: "strategy", status: "accepted", decidedOn: "2026-01-15" }),
    ]);
    expect(s.recent.map((d) => d.id)).toEqual(["b", "a", "c"]);
    expect(s.byCategory[0]?.category).toBe("design");
    expect(s.byCategory[0]?.count).toBe(2);
  });
});
