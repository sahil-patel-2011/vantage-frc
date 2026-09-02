import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { loadPlanRun, modeStateFromRow, normalizeStoredPlan, type CadPlanRunStep } from "./agent-mode-session";

const NOW = Date.parse("2026-09-01T12:00:00.000Z");

describe("tool-call plans", () => {
  it("keeps tool, args and sequence on normalized steps and recomputes the dry run", () => {
    const plan = normalizeStoredPlan({
      planId: "p1",
      brief: "plate",
      steps: [
        { title: "Outline", tool: "onshape_sketch_rectangle", args: { widthMm: 80, heightMm: 50 }, sequence: 3, dryRun: "stale text" },
        { title: "Ask about holes" },
      ],
      questions: [],
      answers: [],
      approved: false,
    });
    expect(plan?.planId).toBe("p1");
    expect(plan?.steps[0]).toMatchObject({ index: 1, tool: "onshape_sketch_rectangle", args: { widthMm: 80 }, sequence: 3 });
    expect(plan?.steps[0]?.dryRun).toMatch(/80 mm × 50 mm rectangle/);
    expect(plan?.steps[1]?.tool).toBeUndefined();
    expect(plan?.steps[1]?.sequence).toBeUndefined();
  });

  it("labels plans stored before planIds existed as legacy", () => {
    expect(normalizeStoredPlan({ steps: [{ title: "A" }] })?.planId).toBe("legacy");
  });

  it("carries the plan run through modeStateFromRow only when a plan exists", () => {
    const run: CadPlanRunStep[] = [
      {
        sequence: 1,
        index: 1,
        tool: "onshape_extrude",
        title: "Extrude",
        status: "completed",
        approvalStatus: "approved",
        featureId: "F1",
        error: null,
        narration: "Extruded 6 mm (NEW)",
        vaultHref: null,
      },
    ];
    const withPlan = modeStateFromRow(
      { mode: "plan", proposed_mode: null, proposed_at: null, plan: { planId: "p", steps: [{ title: "x", tool: "onshape_extrude", sequence: 1 }] }, tasks: null },
      NOW,
      run,
    );
    expect(withPlan.planRun).toEqual(run);
    const withoutPlan = modeStateFromRow({ mode: "plan", proposed_mode: null, proposed_at: null, plan: null, tasks: null }, NOW, run);
    expect(withoutPlan.planRun).toBeNull();
  });
});

describe("loadPlanRun", () => {
  it("reads outcome rows from cad_job_steps and lifts narration, feature id and vault link", async () => {
    const client = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        expect(sql).toMatch(/FROM cad_job_steps/);
        expect(sql).toMatch(/parameters->>'planId'=\$3/);
        expect(params).toEqual(["org-1", "job-1", "plan-1"]);
        return {
          rows: [
            {
              sequence: 4,
              operation: "onshape_export_stl",
              parameters: { planId: "plan-1", planIndex: 2, title: "Export" },
              status: "completed",
              approval_status: "approved",
              output: { narration: { title: "Saved STL" }, destination: { kind: "vault", href: "/cad-vault?orgId=o&document=d" } },
              error: null,
            },
            {
              sequence: 5,
              operation: "onshape_fillet",
              parameters: { planId: "plan-1", planIndex: 3, title: "Fillet" },
              status: "failed",
              approval_status: "approved",
              output: { ok: false },
              error: "no corner edges",
            },
            {
              sequence: 6,
              operation: "onshape_mirror",
              parameters: { planId: "plan-1", planIndex: 4, title: "Mirror" },
              status: "bogus",
              approval_status: "rejected",
              output: null,
              error: null,
            },
          ],
          rowCount: 3,
        };
      }),
    } as unknown as PoolClient;
    const run = await loadPlanRun(client, { orgId: "org-1", jobId: "job-1", planId: "plan-1" });
    expect(run).toHaveLength(3);
    expect(run[0]).toMatchObject({ sequence: 4, index: 2, status: "completed", narration: "Saved STL", vaultHref: "/cad-vault?orgId=o&document=d" });
    expect(run[1]).toMatchObject({ status: "failed", error: "no corner edges", featureId: null });
    // Unknown statuses fall back to "planned" rather than crashing the pane.
    expect(run[2]).toMatchObject({ status: "planned", approvalStatus: "rejected" });
  });
});

describe("discardCadPlan", () => {
  it("cancels the plan's unrun cad_job_steps rows, clears the plan, and reports the fresh state", async () => {
    const { discardCadPlan } = await import("./agent-mode-session");
    let storedPlan: unknown = { planId: "plan-7", steps: [{ title: "Extrude", tool: "onshape_extrude", sequence: 2 }], questions: [] };
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const client = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        if (/FROM cad_jobs/.test(sql)) {
          return { rows: [{ id: "job-1", mode: "plan", proposed_mode: null, proposed_at: null, plan: storedPlan, tasks: null }], rowCount: 1 };
        }
        if (/UPDATE cad_jobs SET plan=/.test(sql)) {
          storedPlan = params[2] ? JSON.parse(String(params[2])) : null;
          return { rows: [], rowCount: 1 };
        }
        if (/UPDATE cad_job_steps SET status='cancelled'/.test(sql)) return { rows: [], rowCount: 1 };
        if (/FROM cad_job_steps/.test(sql)) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      }),
    } as unknown as PoolClient;

    const state = await discardCadPlan(client, { orgId: "org-1", userId: "u1" });

    const cancel = calls.find((call) => /UPDATE cad_job_steps SET status='cancelled'/.test(call.sql));
    expect(cancel).toBeDefined();
    expect(cancel!.sql).toMatch(/parameters->>'planId'=\$3 AND status='planned'/);
    expect(cancel!.params).toEqual(["org-1", "job-1", "plan-7"]);
    const clear = calls.find((call) => /UPDATE cad_jobs SET plan=/.test(call.sql));
    expect(clear!.params[2]).toBeNull();
    expect(state.mode).toBe("plan");
    expect(state.plan).toBeNull();
    expect(state.planRun).toBeNull();
  });

  it("does not touch cad_job_steps for a legacy narrative plan", async () => {
    const { discardCadPlan } = await import("./agent-mode-session");
    let storedPlan: unknown = { steps: [{ title: "Narrative only" }] };
    const client = {
      query: vi.fn(async (sql: string) => {
        if (/FROM cad_jobs/.test(sql)) {
          return { rows: [{ id: "job-1", mode: "plan", proposed_mode: null, proposed_at: null, plan: storedPlan, tasks: null }], rowCount: 1 };
        }
        if (/UPDATE cad_jobs SET plan=/.test(sql)) {
          storedPlan = null;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
    } as unknown as PoolClient;
    await discardCadPlan(client, { orgId: "org-1", userId: "u1" });
    const sqls = (client.query as unknown as { mock: { calls: Array<[string]> } }).mock.calls.map(([sql]) => sql);
    expect(sqls.some((sql) => /cad_job_steps/.test(sql))).toBe(false);
  });
});
