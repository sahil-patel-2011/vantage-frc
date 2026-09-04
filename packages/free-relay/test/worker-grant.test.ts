import { describe, expect, it, vi } from "vitest";
import { runFreeRelayJob, scheduleMemoryDreamJobs } from "../src/worker";

type QueryResult = { rows: unknown[]; rowCount?: number };

function fakeClient(
  handlers: Array<(sql: string, params?: unknown[]) => QueryResult | Promise<QueryResult>>,
) {
  let index = 0;
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      const handler = handlers[index++];
      if (!handler) throw new Error(`Unexpected query: ${sql}`);
      return handler(sql, params);
    }),
  };
}

describe("free-relay worker grant gate", () => {
  it("only schedules memory dreams for orgs with an active platform_relay grant", async () => {
    const client = fakeClient([
      (sql) => {
        expect(sql).toMatch(/org_ai_access_grants/);
        expect(sql).toMatch(/platform_relay/);
        return { rows: [] };
      },
    ]);
    const result = await scheduleMemoryDreamJobs(client as never);
    expect(result.scheduled).toBe(0);
  });

  it("skips a claimed job when the org no longer holds a relay grant", async () => {
    const client = fakeClient([
      () => ({
        rows: [{ orgId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", kind: "memory_dream", metadata: {} }],
      }),
      (sql) => {
        expect(sql).toMatch(/org_ai_access_grants/);
        return { rows: [{ exists: false }] };
      },
      (sql, params) => {
        expect(sql).toMatch(/status = 'skipped'/);
        expect(String(params?.[1])).toMatch(/no_platform_relay_grant/);
        return { rows: [] };
      },
    ]);

    await runFreeRelayJob(client as never, "job-1", {
      provider: "test",
      model: "glm/glm-5.3-flash",
      complete: async () => {
        throw new Error("must not call the model without a grant");
      },
    } as never);
  });
});
