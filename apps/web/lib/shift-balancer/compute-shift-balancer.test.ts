import { describe, expect, it, vi } from "vitest";
import { computeShiftBalancerView } from "./compute-shift-balancer";
import { generateRotation, summarizePlan } from ".";

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

describe("computeShiftBalancerView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const { client } = makeClient([{ rows: [] }]);

    const view = await computeShiftBalancerView(client, { userId: "user-1", requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("computes a live view with plan summary from mock rows", async () => {
    const now = new Date().toISOString();
    const { client } = makeClient([
      { rows: [{ orgId: "org-1", teamNumber: 254 }] },
      {
        rows: [
          { id: "scout-a", name: "Ada", active: true },
          { id: "scout-b", name: "Bo", active: true },
          { id: "scout-c", name: "Cy", active: true },
        ],
      },
      {
        rows: [
          {
            id: "plan-1",
            label: "Qual rotation",
            matchCount: 2,
            stations: ["Red 1", "Blue 1"],
            maxConsecutiveMatches: 1,
            assignments: [
              { match: 1, station: "Red 1", scoutId: "scout-a", scoutName: "Ada" },
              { match: 1, station: "Blue 1", scoutId: "scout-b", scoutName: "Bo" },
              { match: 2, station: "Red 1", scoutId: "scout-c", scoutName: "Cy" },
              { match: 2, station: "Blue 1", scoutId: "scout-a", scoutName: "Ada" },
            ],
            createdAt: now,
          },
        ],
      },
    ]);

    const view = await computeShiftBalancerView(client, { userId: "user-1", requestedOrg: "org-1" });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");

    expect(view.orgId).toBe("org-1");
    expect(view.teamNumber).toBe(254);
    expect(view.scouts).toHaveLength(3);
    expect(view.plans).toHaveLength(1);
    expect(view.latestSummary).not.toBeNull();
    expect(view.latestSummary?.totalShifts).toBe(4);
    expect(view.latestSummary?.scoutsUsed).toBe(3);
  });
});

describe("generateRotation", () => {
  it("caps consecutive matches per scout while filling every station", () => {
    const scouts = [
      { id: "a", name: "Ada", active: true },
      { id: "b", name: "Bo", active: true },
    ];
    const assignments = generateRotation({
      scouts,
      matchCount: 6,
      stations: ["Red 1"],
      maxConsecutiveMatches: 2,
    });

    expect(assignments).toHaveLength(6);

    // No scout should ever work 3 matches in a row.
    let streak = 0;
    let lastScout: string | null = null;
    for (const a of assignments) {
      if (a.scoutId === lastScout) {
        streak += 1;
      } else {
        streak = 1;
        lastScout = a.scoutId;
      }
      expect(streak).toBeLessThanOrEqual(2);
    }
  });

  it("returns an empty rotation for an empty roster", () => {
    expect(generateRotation({ scouts: [], matchCount: 5, stations: ["Red 1"], maxConsecutiveMatches: 2 })).toEqual(
      [],
    );
  });
});

describe("summarizePlan", () => {
  it("flags a roster shortfall when active scouts are fewer than stations", () => {
    const scouts = [{ id: "a", name: "Ada", active: true }];
    const summary = summarizePlan({
      scouts,
      matchCount: 1,
      stations: ["Red 1", "Blue 1"],
      assignments: [{ match: 1, station: "Red 1", scoutId: "a", scoutName: "Ada" }],
    });
    expect(summary.rosterShortfall).toBe(true);
    expect(summary.totalShifts).toBe(1);
  });
});
