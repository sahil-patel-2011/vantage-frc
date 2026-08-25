import { describe, expect, it } from "vitest";
import { DEFAULT_CAD_AGENT_MODE_STATE, modeStateFromRow, normalizeStoredPlan } from "./agent-mode-session";

const NOW = Date.parse("2026-08-23T12:00:00.000Z");

describe("modeStateFromRow", () => {
  it("defaults to simple with no row", () => {
    expect(modeStateFromRow(null, NOW)).toEqual(DEFAULT_CAD_AGENT_MODE_STATE);
  });

  it("normalizes a live proposal with its 15-second expiry", () => {
    const proposedAt = new Date(NOW - 4_000);
    const state = modeStateFromRow(
      { mode: "simple", proposed_mode: "multitask", proposed_at: proposedAt, plan: null, tasks: null },
      NOW,
    );
    expect(state.mode).toBe("simple");
    expect(state.proposal?.mode).toBe("multitask");
    expect(state.proposal?.expiresAt).toBe(new Date(proposedAt.getTime() + 15_000).toISOString());
  });

  it("treats a proposal older than 15 seconds as declined (no zombie on reload)", () => {
    const state = modeStateFromRow(
      { mode: "plan", proposed_mode: "multitask", proposed_at: new Date(NOW - 16_000), plan: null, tasks: null },
      NOW,
    );
    expect(state.proposal).toBeNull();
    expect(state.mode).toBe("plan");
  });

  it("falls back to simple for unknown stored modes and proposals", () => {
    const state = modeStateFromRow(
      { mode: "yolo", proposed_mode: "warp", proposed_at: new Date(NOW), plan: null, tasks: null },
      NOW,
    );
    expect(state.mode).toBe("simple");
    expect(state.proposal).toBeNull();
  });

  it("normalizes stored plan and tasks jsonb", () => {
    const state = modeStateFromRow(
      {
        mode: "plan",
        proposed_mode: null,
        proposed_at: null,
        plan: {
          brief: "bracket",
          steps: [{ title: "Sketch outline", detail: "Top plane" }, { title: "" }, { detail: "no title" }],
          questions: ["Thickness?"],
          answers: ["6 mm"],
          approved: false,
        },
        tasks: [{ id: "t1", title: "Outline", status: "done", note: "ok" }, { title: "Holes" }],
      },
      NOW,
    );
    expect(state.plan?.steps).toHaveLength(1);
    expect(state.plan?.steps[0]).toMatchObject({ index: 1, title: "Sketch outline" });
    expect(state.plan?.answers).toEqual(["6 mm"]);
    expect(state.tasks).toHaveLength(2);
    expect(state.tasks?.[1]).toMatchObject({ id: "t2", status: "pending" });
  });
});

describe("normalizeStoredPlan", () => {
  it("rejects plans without usable steps", () => {
    expect(normalizeStoredPlan(null)).toBeNull();
    expect(normalizeStoredPlan({ steps: [] })).toBeNull();
    expect(normalizeStoredPlan({ steps: [{ detail: "no title" }] })).toBeNull();
    expect(normalizeStoredPlan("plan")).toBeNull();
  });

  it("re-indexes steps and coerces flags", () => {
    const plan = normalizeStoredPlan({
      brief: "b",
      steps: [{ title: "A" }, { title: "B" }],
      questions: ["Q1", ""],
      answers: ["a1"],
      approved: "yes",
    });
    expect(plan?.steps.map((s) => s.index)).toEqual([1, 2]);
    expect(plan?.questions).toEqual(["Q1"]);
    expect(plan?.approved).toBe(false);
  });
});
