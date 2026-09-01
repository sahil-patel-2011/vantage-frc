import { describe, expect, it } from "vitest";
import {
  computeCoverageScore,
  countEligibleWorkBySource,
  findKnowledgeGaps,
  isEligibleWorkItem,
  knowledgeGapSubjectLabel,
  subjectKindForWorkSource,
  summarizeScan,
  workSourceForSubjectKind,
} from ".";
import type { KnowledgeGapPage, KnowledgeGapWorkItem } from "./types";

function work(over: Partial<KnowledgeGapWorkItem> & Pick<KnowledgeGapWorkItem, "id" | "source" | "title">): KnowledgeGapWorkItem {
  return {
    status: "planned",
    grouping: null,
    ...over,
  };
}

function page(over: Partial<KnowledgeGapPage> & Pick<KnowledgeGapPage, "id" | "title">): KnowledgeGapPage {
  return {
    body: "",
    tags: [],
    seasonYear: 2026,
    ...over,
  };
}

describe("findKnowledgeGaps", () => {
  it("returns no gaps when there are no work items — never invents subjects", () => {
    const gaps = findKnowledgeGaps({
      workItems: [],
      pages: [page({ id: "p1", title: "Empty wiki", body: "Nothing about work." })],
      seasonYear: 2026,
    });
    expect(gaps).toEqual([]);
  });

  it("returns no gaps when the wiki is empty and no work exists", () => {
    expect(findKnowledgeGaps({ workItems: [], pages: [], seasonYear: 2026 })).toEqual([]);
  });

  it("lists only real undocumented work items", () => {
    const gaps = findKnowledgeGaps({
      workItems: [
        work({ id: "t1", source: "todo", title: "Wire the elevator" }),
        work({ id: "b1", source: "build_task", title: "Machine the gearbox plate", grouping: "drivetrain" }),
        work({ id: "m1", source: "milestone", title: "Week 3 robot reveal" }),
      ],
      pages: [page({ id: "p1", title: "Elevator notes", body: "How we wire the elevator." })],
      seasonYear: 2026,
    });

    expect(gaps.map((g) => g.subjectRef).sort()).toEqual(["Machine the gearbox plate", "Week 3 robot reveal"]);
    expect(gaps.some((g) => g.subjectRef === "Wire the elevator")).toBe(false);
    expect(gaps.find((g) => g.subjectId === "b1")?.subjectKind).toBe("subsystem");
    expect(gaps.find((g) => g.subjectId === "m1")?.subjectKind).toBe("event");
    expect(gaps.every((g) => g.seasonYear === 2026)).toBe(true);
  });

  it("never invents DEMO or placeholder gap titles", () => {
    const gaps = findKnowledgeGaps({
      workItems: [work({ id: "t1", source: "todo", title: "Order bumpers" })],
      pages: [],
      seasonYear: 2026,
    });
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.subjectRef).toBe("Order bumpers");
    expect(JSON.stringify(gaps)).not.toMatch(/DEMO|placeholder|example work/i);
  });

  it("skips dropped work and blank titles so those cannot become invented gaps", () => {
    const gaps = findKnowledgeGaps({
      workItems: [
        work({ id: "d1", source: "todo", title: "Cancelled shop day", status: "dropped" }),
        work({ id: "e1", source: "build_task", title: "   " }),
        work({ id: "ok", source: "todo", title: "Write pit checklist" }),
      ],
      pages: [],
      seasonYear: 2026,
    });
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.subjectId).toBe("ok");
    expect(gaps[0]?.subjectKind).toBe("decision");
  });

  it("treats a wiki tag mention as coverage", () => {
    const gaps = findKnowledgeGaps({
      workItems: [work({ id: "t1", source: "todo", title: "Swerve encoder swap" })],
      pages: [page({ id: "p1", title: "Electrical", tags: ["swerve encoder swap"] })],
      seasonYear: 2026,
    });
    expect(gaps).toEqual([]);
  });

  it("does not emit a gap for an id that is not in the work list", () => {
    const gaps = findKnowledgeGaps({
      workItems: [work({ id: "real-1", source: "milestone", title: "Bag day" })],
      pages: [],
      seasonYear: 2026,
    });
    expect(gaps.every((g) => g.subjectId === "real-1")).toBe(true);
    expect(gaps.some((g) => g.subjectRef.toLowerCase().includes("drivetrain") && g.subjectId !== "real-1")).toBe(
      false,
    );
  });
});

describe("eligibility and coverage helpers", () => {
  it("counts only eligible work by source", () => {
    const counts = countEligibleWorkBySource([
      work({ id: "t1", source: "todo", title: "A" }),
      work({ id: "t2", source: "todo", title: "B", status: "dropped" }),
      work({ id: "b1", source: "build_task", title: "C" }),
      work({ id: "m1", source: "milestone", title: "D", status: "done" }),
    ]);
    expect(counts).toEqual({ todos: 1, buildTasks: 1, milestones: 1, total: 3 });
  });

  it("coverage is 1 when there is nothing to track", () => {
    expect(computeCoverageScore(0, 0)).toBe(1);
    expect(summarizeScan({ totalSubjects: 0, gapCount: 0, coverageScore: 1 })).toMatch(/No work items/);
  });

  it("maps work sources onto the persisted subject kinds", () => {
    expect(subjectKindForWorkSource("todo")).toBe("decision");
    expect(subjectKindForWorkSource("build_task")).toBe("subsystem");
    expect(subjectKindForWorkSource("milestone")).toBe("event");
    expect(workSourceForSubjectKind("decision")).toBe("todo");
    expect(knowledgeGapSubjectLabel("subsystem")).toBe("Build task");
    expect(isEligibleWorkItem(work({ id: "x", source: "todo", title: "Ok" }))).toBe(true);
  });
});
