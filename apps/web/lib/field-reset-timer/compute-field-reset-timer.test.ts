import { describe, expect, it, vi } from "vitest";
import { computeFieldResetTimerView } from "./compute-field-reset-timer";

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

describe("computeFieldResetTimerView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const { client } = makeClient([{ rows: [] }]);

    const view = await computeFieldResetTimerView(client, { userId: "user-1", requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("computes a live summary with session rollups and readiness from mock rows", async () => {
    const now = new Date().toISOString();

    const { client } = makeClient([
      { rows: [{ orgId: "org-1", teamNumber: 254 }] },
      {
        rows: [
          {
            id: "session-1",
            label: "Tuesday practice",
            occurredOn: "2026-07-14",
            seasonYear: 2026,
            notes: null,
            cycleCount: "3",
          },
        ],
      },
      { rows: [{ seasonYear: 2026 }] },
      {
        rows: [
          {
            id: "cycle-1",
            sessionId: "session-1",
            cycleNumber: 1,
            resetSeconds: "22.00",
            cycleSeconds: "45.00",
            note: null,
            recordedAt: now,
          },
          {
            id: "cycle-2",
            sessionId: "session-1",
            cycleNumber: 2,
            resetSeconds: "18.00",
            cycleSeconds: "40.00",
            note: null,
            recordedAt: now,
          },
          {
            id: "cycle-3",
            sessionId: "session-1",
            cycleNumber: 3,
            resetSeconds: "20.00",
            cycleSeconds: null,
            note: "Dropped a game piece",
            recordedAt: now,
          },
        ],
      },
    ]);

    const view = await computeFieldResetTimerView(client, {
      userId: "user-1",
      requestedOrg: "org-1",
      seasonYear: 2026,
    });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");

    expect(view.orgId).toBe("org-1");
    expect(view.teamNumber).toBe(254);
    expect(view.sessions).toHaveLength(1);
    expect(view.cycles).toHaveLength(3);

    const summary = view.sessionSummaries.find((s) => s.sessionId === "session-1");
    expect(summary?.cycleCount).toBe(3);
    expect(summary?.bestResetSeconds).toBe(18);
    expect(summary?.worstResetSeconds).toBe(22);
    expect(summary?.avgResetSeconds).toBeCloseTo(20, 5);

    expect(view.readiness.totalCycles).toBe(3);
    expect(view.readiness.sessionsLogged).toBe(1);
    expect(view.readiness.score).toBeGreaterThanOrEqual(0);
    expect(view.readiness.score).toBeLessThanOrEqual(1);
  });
});
