import { describe, expect, it, vi } from "vitest";
import { computeGoalsTrackerView } from "./compute-goals-tracker";

type QueryCall = { text: string; values: unknown[] };

function makeClient(handlers: {
  membership?: { orgId: string; teamNumber: number | null } | null;
  goals?: Array<Record<string, unknown>>;
  seasons?: Array<{ seasonYear: number }>;
  checkins?: Array<Record<string, unknown>>;
}) {
  const calls: QueryCall[] = [];
  const client = {
    query: vi.fn(async (text: string, values: unknown[] = []) => {
      calls.push({ text, values });
      if (text.includes("FROM memberships")) {
        return { rows: handlers.membership ? [handlers.membership] : [] };
      }
      if (text.includes("FROM goals_tracker_goals") && text.includes("DISTINCT")) {
        return { rows: handlers.seasons ?? [] };
      }
      if (text.includes("FROM goals_tracker_goals")) {
        return { rows: handlers.goals ?? [] };
      }
      if (text.includes("FROM goals_tracker_checkins")) {
        return { rows: handlers.checkins ?? [] };
      }
      return { rows: [] };
    }),
  };
  return { client: client as unknown as import("@neondatabase/serverless").PoolClient, calls };
}

describe("computeGoalsTrackerView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const { client } = makeClient({ membership: null });
    const view = await computeGoalsTrackerView(client, { userId: "u1", requestedOrg: null });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("computes live progress and summary from goals and their check-ins", async () => {
    const { client } = makeClient({
      membership: { orgId: "org-1", teamNumber: 1234 },
      goals: [
        {
          id: "goal-1",
          title: "Ship autonomous routine",
          description: "Reliable 3-piece auto",
          category: "build",
          metricUnit: "percent",
          startValue: "0",
          targetValue: "100",
          status: "active",
          dueOn: "2026-12-31",
          seasonYear: 2026,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "goal-2",
          title: "Win a regional award",
          description: null,
          category: "competition",
          metricUnit: "count",
          startValue: "0",
          targetValue: "1",
          status: "completed",
          dueOn: null,
          seasonYear: 2026,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      seasons: [{ seasonYear: 2026 }],
      checkins: [
        {
          id: "chk-1",
          goalId: "goal-1",
          value: "60",
          note: "Halfway there",
          occurredOn: "2026-06-01",
          createdAt: "2026-06-01T00:00:00.000Z",
        },
      ],
    });

    const view = await computeGoalsTrackerView(client, {
      userId: "u1",
      requestedOrg: "org-1",
      seasonYear: 2026,
    });

    expect(view.status).toBe("live");
    if (view.status !== "live") return;
    expect(view.orgId).toBe("org-1");
    expect(view.goals).toHaveLength(2);

    const goal1 = view.goals.find((g) => g.goal.id === "goal-1");
    expect(goal1?.latestValue).toBe(60);
    expect(goal1?.progress).toBeCloseTo(0.6);
    expect(goal1?.checkinCount).toBe(1);

    const goal2 = view.goals.find((g) => g.goal.id === "goal-2");
    expect(goal2?.progress).toBe(1); // completed goals are always full progress
    expect(goal2?.checkinCount).toBe(0);

    expect(view.summary.totalGoals).toBe(2);
    expect(view.summary.activeGoals).toBe(1);
    expect(view.summary.completedGoals).toBe(1);
  });
});
