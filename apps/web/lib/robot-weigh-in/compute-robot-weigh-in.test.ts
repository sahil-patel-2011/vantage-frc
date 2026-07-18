import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { computeRobotWeighInView } from "./compute-robot-weigh-in";
import { summarizeRobotWeighIn } from ".";
import type { RobotWeighInEntry } from "./types";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeRobotWeighInView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeRobotWeighInView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view with a weight-vs-limit summary over logged entries", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM robot_weigh_in_entries") && sql.includes("SELECT id")) {
        return {
          rows: [
            {
              id: "e2",
              weighedOn: "2026-02-05",
              weightLbs: "126.50",
              weightLimitLbs: "125.00",
              station: "event_inspection",
              bumpersOn: true,
              batteryOn: true,
              seasonYear: 2026,
              notes: null,
            },
            {
              id: "e1",
              weighedOn: "2026-01-10",
              weightLbs: "118.00",
              weightLimitLbs: "125.00",
              station: "shop",
              bumpersOn: true,
              batteryOn: true,
              seasonYear: 2026,
              notes: "Initial weigh-in",
            },
          ],
        };
      }
      if (sql.includes("DISTINCT season_year")) {
        return { rows: [{ seasonYear: 2026 }] };
      }
      return { rows: [] };
    });

    const view = await computeRobotWeighInView(client, { userId: USER, requestedOrg: ORG });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.orgId).toBe(ORG);
    expect(view.teamNumber).toBe(254);
    expect(view.entries).toHaveLength(2);
    expect(view.summary.totalEntries).toBe(2);
    expect(view.summary.latestWeightLbs).toBe(126.5);
    expect(view.summary.latestMarginLbs).toBe(-1.5);
    expect(view.summary.overLimitCount).toBe(1);
    expect(view.summary.trend).toHaveLength(2);
    expect(view.summary.trend[0].weighedOn).toBe("2026-01-10");
  });
});

let seq = 0;
function entry(overrides: Partial<RobotWeighInEntry> = {}): RobotWeighInEntry {
  seq += 1;
  return {
    id: `entry-${seq}`,
    weighedOn: "2026-02-15",
    weightLbs: 120,
    weightLimitLbs: 125,
    station: "shop",
    bumpersOn: true,
    batteryOn: true,
    seasonYear: 2026,
    notes: null,
    ...overrides,
  };
}

describe("summarizeRobotWeighIn", () => {
  it("returns an all-null/zero summary for no entries", () => {
    const s = summarizeRobotWeighIn([]);
    expect(s.totalEntries).toBe(0);
    expect(s.latestWeightLbs).toBeNull();
    expect(s.latestMarginLbs).toBeNull();
    expect(s.overLimitCount).toBe(0);
    expect(s.trend).toEqual([]);
  });

  it("computes min/max, margin, and over-limit counts across entries", () => {
    const s = summarizeRobotWeighIn([
      entry({ weighedOn: "2026-02-20", weightLbs: 130, weightLimitLbs: 125 }),
      entry({ weighedOn: "2026-01-05", weightLbs: 110, weightLimitLbs: 125 }),
    ]);
    expect(s.totalEntries).toBe(2);
    expect(s.minWeightLbs).toBe(110);
    expect(s.maxWeightLbs).toBe(130);
    expect(s.overLimitCount).toBe(1);
    expect(s.trend[0].weighedOn).toBe("2026-01-05");
    expect(s.trend[1].weighedOn).toBe("2026-02-20");
    expect(s.trend[1].marginLbs).toBe(-5);
  });
});
