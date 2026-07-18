import { describe, expect, it, vi } from "vitest";
import { computeSeasonRolloverView } from "./compute-season-rollover";

type QueryCall = { text: string; values: unknown[] };

function makeClient(responses: Array<{ rows: unknown[] }>) {
  const calls: QueryCall[] = [];
  let index = 0;
  const client = {
    query: vi.fn(async (text: string, values: unknown[] = []) => {
      calls.push({ text, values });
      const response = responses[Math.min(index, responses.length - 1)];
      index += 1;
      return response;
    }),
  };
  return { client: client as unknown as import("@neondatabase/serverless").PoolClient, calls };
}

describe("computeSeasonRolloverView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const { client } = makeClient([{ rows: [] }]);

    const view = await computeSeasonRolloverView(client, { userId: "user-1", requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
      expect(view.toSeasonYear).toBeGreaterThan(2000);
    }
  });

  it("computes a live rollover summary with plan grouping and category breakdown from mock rows", async () => {
    const now = new Date().toISOString();

    const { client } = makeClient([
      { rows: [{ orgId: "org-1", teamNumber: 254 }] },
      {
        rows: [
          {
            id: "plan-1",
            fromSeasonYear: 2025,
            toSeasonYear: 2026,
            status: "in_progress",
            notes: "Kickoff prep",
            createdAt: now,
            completedAt: null,
          },
          {
            id: "plan-0",
            fromSeasonYear: 2024,
            toSeasonYear: 2025,
            status: "completed",
            notes: null,
            createdAt: now,
            completedAt: now,
          },
        ],
      },
      {
        rows: [
          {
            id: "item-1",
            planId: "plan-1",
            category: "roster",
            label: "Returning members list",
            carried: true,
            notes: null,
            createdAt: now,
            carriedAt: now,
          },
          {
            id: "item-2",
            planId: "plan-1",
            category: "scouting_schema",
            label: "2026 scouting form fields",
            carried: false,
            notes: null,
            createdAt: now,
            carriedAt: null,
          },
          {
            id: "item-3",
            planId: "plan-0",
            category: "config",
            label: "2025 org settings",
            carried: true,
            notes: null,
            createdAt: now,
            carriedAt: now,
          },
        ],
      },
    ]);

    const view = await computeSeasonRolloverView(client, {
      userId: "user-1",
      requestedOrg: "org-1",
      toSeasonYear: 2026,
    });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");

    expect(view.orgId).toBe("org-1");
    expect(view.teamNumber).toBe(254);
    expect(view.plans).toHaveLength(2);

    expect(view.activePlan?.id).toBe("plan-1");
    expect(view.activePlan?.items).toHaveLength(2);

    expect(view.summary.totalItems).toBe(2);
    expect(view.summary.carriedItems).toBe(1);
    expect(view.summary.completionRate).toBeCloseTo(0.5);
    expect(view.summary.byCategory.find((row) => row.category === "roster")?.carried).toBe(1);
    expect(view.summary.byCategory.find((row) => row.category === "scouting_schema")?.carried).toBe(0);
  });
});
