import { describe, expect, it, vi } from "vitest";
import { computeMatchChecklistView } from "./compute-match-checklist";

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

describe("computeMatchChecklistView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const { client } = makeClient([{ rows: [] }]);

    const view = await computeMatchChecklistView(client, { userId: "user-1", requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
      expect(view.steps.map((s) => s.id)).toContain("workspace");
      expect(view.message.toLowerCase()).not.toContain("demo");
    }
  });

  it("computes a live summary with elapsed time and readiness from mock runs", async () => {
    const now = new Date();
    const startedOpen = new Date(now.getTime() - 45 * 1000).toISOString();
    const startedDone = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
    const completedDone = new Date(now.getTime() - 9 * 60 * 1000).toISOString();

    const { client } = makeClient([
      { rows: [{ orgId: "org-1", teamNumber: 254 }] },
      {
        rows: [
          {
            id: "run-open",
            matchLabel: "Qualification 12",
            eventKey: "2026miket",
            teamNumber: 254,
            startedAt: startedOpen,
            completedAt: null,
            items: [
              { key: "bumper", label: "Bumpers secured", done: true, checkedAt: startedOpen },
              { key: "battery", label: "Battery charged & seated", done: false, checkedAt: null },
              { key: "tether", label: "Tether / e-stop clipped", done: false, checkedAt: null },
              { key: "code", label: "Code deployed & radio linked", done: false, checkedAt: null },
            ],
          },
          {
            id: "run-done",
            matchLabel: "Qualification 11",
            eventKey: "2026miket",
            teamNumber: 254,
            startedAt: startedDone,
            completedAt: completedDone,
            items: [
              { key: "bumper", label: "Bumpers secured", done: true, checkedAt: startedDone },
              { key: "battery", label: "Battery charged & seated", done: true, checkedAt: startedDone },
              { key: "tether", label: "Tether / e-stop clipped", done: true, checkedAt: startedDone },
              { key: "code", label: "Code deployed & radio linked", done: true, checkedAt: completedDone },
            ],
          },
        ],
      },
    ]);

    const view = await computeMatchChecklistView(client, { userId: "user-1", requestedOrg: "org-1" });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");

    expect(view.orgId).toBe("org-1");
    expect(view.teamNumber).toBe(254);
    expect(view.runs).toHaveLength(2);

    const open = view.runs.find((r) => r.id === "run-open");
    expect(open?.allDone).toBe(false);
    expect(open?.completedAt).toBeNull();
    expect(open?.elapsedSeconds).toBeGreaterThanOrEqual(40);

    const done = view.runs.find((r) => r.id === "run-done");
    expect(done?.allDone).toBe(true);
    expect(done?.elapsedSeconds).toBe(60);

    expect(view.summary.totalRuns).toBe(2);
    expect(view.summary.completedRuns).toBe(1);
    expect(view.summary.openRuns).toBe(1);
    expect(view.summary.averageElapsedSeconds).toBe(60);
    expect(view.summary.fastestElapsedSeconds).toBe(60);
  });
});
