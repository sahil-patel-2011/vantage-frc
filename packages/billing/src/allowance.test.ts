import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { readOrgAllowance } from "./allowance";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[] }): PoolClient {
  return { query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)) } as unknown as PoolClient;
}

describe("readOrgAllowance", () => {
  it("reports the cap and window meteredAI enforces, and what consumed it", async () => {
    const seen: unknown[][] = [];
    const client = makeClient((sql, params) => {
      seen.push(params);
      if (sql.includes("FROM org_billing")) {
        return {
          rows: [
            {
              tier: "free",
              creditCapUsd: "5",
              killSwitch: false,
              periodStart: "2026-09-01 00:00:00-04",
              periodEnd: "2026-10-01 00:00:00-04",
            },
          ],
        };
      }
      if (sql.includes("FROM ai_usage_events")) {
        return {
          rows: [
            { feature: "strategy", calls: "2", cost: "1.75", tokens: "3000" },
            { feature: "scouting", calls: "1", cost: "0.75", tokens: "1500" },
          ],
        };
      }
      return { rows: [] };
    });

    const allowance = await readOrgAllowance(client, ORG);

    expect(allowance.configured).toBe(true);
    expect(allowance.tier).toBe("free");
    expect(allowance.includedAllowanceUsd).toBe(5);
    expect(allowance.usedUsd).toBe(2.5);
    expect(allowance.remainingUsd).toBe(2.5);
    expect(allowance.percentUsed).toBe(50);
    expect(allowance.byFeature).toEqual([
      { feature: "strategy", calls: 2, costUsd: 1.75, tokens: 3000 },
      { feature: "scouting", calls: 1, costUsd: 0.75, tokens: 1500 },
    ]);

    // The spend query must be bounded by the billing period, not run over all
    // time — a monthly cap compared against a lifetime sum can never fall back
    // down once a team has used AI for more than one month.
    const spendParams = seen[1];
    expect(spendParams).toEqual([ORG, "2026-09-01 00:00:00-04", "2026-10-01 00:00:00-04"]);
  });

  it("reports an unprovisioned org honestly instead of inventing a cap", async () => {
    const client = makeClient(() => ({ rows: [] }));
    const allowance = await readOrgAllowance(client, ORG);

    expect(allowance.configured).toBe(false);
    expect(allowance.includedAllowanceUsd).toBe(0);
    // Not 0% used — there is no allowance to be a percentage of, and rendering
    // "0% of $0" as a healthy bar would be a fabricated number.
    expect(allowance.percentUsed).toBeNull();
    expect(allowance.byFeature).toEqual([]);
  });

  it("never reports negative remaining once a team is over its cap", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM org_billing")) {
        return {
          rows: [
            {
              tier: "free",
              creditCapUsd: "5",
              killSwitch: true,
              periodStart: "2026-09-01 00:00:00-04",
              periodEnd: "2026-10-01 00:00:00-04",
            },
          ],
        };
      }
      return { rows: [{ feature: "chat", calls: "9", cost: "8.25", tokens: "90000" }] };
    });

    const allowance = await readOrgAllowance(client, ORG);
    expect(allowance.usedUsd).toBe(8.25);
    expect(allowance.remainingUsd).toBe(0);
    expect(allowance.percentUsed).toBe(165);
    expect(allowance.killSwitch).toBe(true);
  });
});
