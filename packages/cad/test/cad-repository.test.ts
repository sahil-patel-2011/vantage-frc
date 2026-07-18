import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it } from "vitest";
import { CadRepository } from "../src";

describe("CadRepository adaptive operation plan", () => {
  it("appends an approved allowlisted operation and audits it", async () => {
    const calls: Array<{ sql: string; values: unknown[] | undefined }> = [];
    const client = {
      async query(sql: string, values?: unknown[]) {
        calls.push({ sql, values });
        if (sql.includes("WITH next_step")) return { rows: [{ id: "step-4", sequence: 4 }], rowCount: 1 };
        return { rows: [], rowCount: 1 };
      },
    } as unknown as PoolClient;
    const result = await new CadRepository(client).appendPlanStep("org-1", "job-1", "user-1", {
      operation: "create_extrude",
      parameters: { depth: "25 mm" },
      requiresApproval: true,
      reason: "Reviewed intake plate",
    });
    expect(result).toEqual({ id: "step-4", sequence: 4 });
    expect(calls.some((call) => call.sql.includes("cad.plan.step_appended"))).toBe(false);
    expect(calls.some((call) => call.values?.includes("cad.plan.step_appended"))).toBe(true);
  });

  it("rejects an unapproved geometry mutation before writing", async () => {
    const client = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as PoolClient;
    await expect(
      new CadRepository(client).appendPlanStep("org-1", "job-1", "user-1", {
        operation: "create_shell",
        parameters: { thickness: "2 mm" },
        requiresApproval: false,
        reason: "Unsafe bypass",
      }),
    ).rejects.toThrow(/requires approval/i);
  });
});
