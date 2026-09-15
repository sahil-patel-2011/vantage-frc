import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUTONOMOUS_LIVE_POLL_MAX_MS,
  AUTONOMOUS_LIVE_POLL_MS,
  autonomousCancelBody,
  autonomousStartBody,
  autonomousRunHref,
  autonomousTodosHref,
  isAutonomousRunLive,
  nextAutonomousPollDelayMs,
  nextAutonomousPollTick,
  pickLiveAutonomousRun,
} from "./autonomous-live-poll";

const LIVE = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  goal: "Summarize bumper rules",
  status: "running",
  finishedAt: null,
};

describe("autonomous live poll", () => {
  it("backs off after failed ticks and treats finishedAt or a non-running status as settled", () => {
    expect(AUTONOMOUS_LIVE_POLL_MS).toBe(800);
    expect(nextAutonomousPollDelayMs(0)).toBe(800);
    expect(nextAutonomousPollDelayMs(1)).toBe(1600);
    expect(nextAutonomousPollDelayMs(2)).toBe(3200);
    expect(nextAutonomousPollDelayMs(3)).toBe(AUTONOMOUS_LIVE_POLL_MAX_MS);
    expect(nextAutonomousPollDelayMs(9)).toBe(AUTONOMOUS_LIVE_POLL_MAX_MS);
    expect(isAutonomousRunLive(LIVE)).toBe(true);
    expect(isAutonomousRunLive({ ...LIVE, finishedAt: "2026-09-15T00:00:00.000Z" })).toBe(false);
    expect(isAutonomousRunLive({ ...LIVE, status: "completed", finishedAt: null })).toBe(false);
    expect(isAutonomousRunLive({ ...LIVE, status: "failed", finishedAt: null })).toBe(false);
    expect(isAutonomousRunLive(null)).toBe(false);
  });

  it("omits maxSteps so the store default applies and only sends runId when resuming", () => {
    expect(autonomousStartBody({ orgId: "org-1", goal: "Look up the manual" })).toEqual({
      orgId: "org-1",
      goal: "Look up the manual",
    });
    expect(
      autonomousStartBody({
        orgId: "org-1",
        goal: "Look up the manual",
        runId: LIVE.id,
      }),
    ).toEqual({
      orgId: "org-1",
      goal: "Look up the manual",
      runId: LIVE.id,
    });
    expect(JSON.stringify(autonomousStartBody({ orgId: "org-1", goal: "x" }))).not.toMatch(/maxSteps/);
    const panel = readFileSync(join(__dirname, "..", "..", "app", "ai", "autonomous-agent-panel.tsx"), "utf8");
    expect(panel).not.toMatch(/maxSteps:\s*8/);
    expect(panel).toMatch(/autonomousStartBody/);
  });

  it("discovers the matching running run, then stops once the detail is finished", () => {
    const other = {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      goal: "Something else",
      status: "running",
      finishedAt: null,
    };
    expect(pickLiveAutonomousRun([other, LIVE], LIVE.goal)?.id).toBe(LIVE.id);
    expect(nextAutonomousPollTick({ runId: null, goal: LIVE.goal, listRuns: [] })).toEqual({
      kind: "wait",
    });
    expect(
      nextAutonomousPollTick({ runId: null, goal: LIVE.goal, listRuns: [other, LIVE] }),
    ).toEqual({ kind: "discover", runId: LIVE.id, run: LIVE });
    expect(
      nextAutonomousPollTick({
        runId: LIVE.id,
        goal: LIVE.goal,
        detail: { run: LIVE, steps: [{ sequence: 0 }] },
      }),
    ).toEqual({ kind: "update", run: LIVE, steps: [{ sequence: 0 }], done: false });
    const done = { ...LIVE, status: "completed", finishedAt: "2026-09-15T00:00:00.000Z" };
    expect(
      nextAutonomousPollTick({
        runId: LIVE.id,
        goal: LIVE.goal,
        detail: { run: done, steps: [] },
      }),
    ).toEqual({ kind: "update", run: done, steps: [], done: true });
    expect(
      nextAutonomousPollTick({
        runId: LIVE.id,
        goal: LIVE.goal,
        detail: { run: null, setup_required: true, steps: [] },
      }),
    ).toEqual({ kind: "wait" });
  });

  it("builds the GET hrefs the panel polls", () => {
    expect(autonomousRunHref("org-1", LIVE.id)).toBe(
      `/api/agent/autonomous?orgId=org-1&runId=${LIVE.id}`,
    );
    expect(autonomousTodosHref("org-1", LIVE.id)).toBe(
      `/api/agent/todos?orgId=org-1&runId=${LIVE.id}&scope=autonomous`,
    );
    expect(autonomousCancelBody({ orgId: "org-1", runId: LIVE.id })).toEqual({
      orgId: "org-1",
      runId: LIVE.id,
      action: "cancel",
    });
    const panel = readFileSync(join(__dirname, "..", "..", "app", "ai", "autonomous-agent-panel.tsx"), "utf8");
    expect(panel).toMatch(/autonomousCancelBody/);
    expect(panel).toMatch(/method: "PATCH"/);
    const route = readFileSync(join(__dirname, "..", "..", "app", "api", "agent", "autonomous", "route.ts"), "utf8");
    expect(route).toMatch(/export async function PATCH/);
    expect(route).toMatch(/cancelAutonomousRun/);
  });
});
