import { describe, expect, it, vi } from "vitest";
import { computeScoutFieldBudgetView } from "./compute-scout-field-budget";

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

describe("computeScoutFieldBudgetView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const { client } = makeClient([{ rows: [] }]);

    const view = await computeScoutFieldBudgetView(client, { userId: "user-1", requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("computes a live view with lint results and summary from mock snapshot rows", async () => {
    const now = new Date().toISOString();

    const { client } = makeClient([
      { rows: [{ orgId: "org-1", teamNumber: 254 }] },
      {
        rows: [
          {
            id: "snapshot-over",
            schemaName: "2026 Reefscape v2",
            autoFields: 12,
            teleopFields: 22,
            endgameFields: 8,
            pitFields: 15,
            postMatchFields: 4,
            notes: "Too many fields per scout",
            createdAt: now,
          },
          {
            id: "snapshot-ok",
            schemaName: "2026 Reefscape lean",
            autoFields: 5,
            teleopFields: 10,
            endgameFields: 3,
            pitFields: 12,
            postMatchFields: 4,
            notes: null,
            createdAt: now,
          },
        ],
      },
    ]);

    const view = await computeScoutFieldBudgetView(client, { userId: "user-1", requestedOrg: "org-1" });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");

    expect(view.orgId).toBe("org-1");
    expect(view.teamNumber).toBe(254);
    expect(view.snapshots).toHaveLength(2);

    const overSnapshot = view.lints.find((l) => l.snapshotId === "snapshot-over");
    expect(overSnapshot?.overBudget).toBe(true);
    expect(overSnapshot?.severity).not.toBe("ok");
    expect(overSnapshot?.recommendations.length).toBeGreaterThan(0);

    const okSnapshot = view.lints.find((l) => l.snapshotId === "snapshot-ok");
    expect(okSnapshot?.overBudget).toBe(false);
    expect(okSnapshot?.severity).toBe("ok");

    expect(view.summary.totalSnapshots).toBe(2);
    expect(view.summary.overBudgetCount).toBe(1);
    expect(view.summary.okCount).toBe(1);
    expect(view.summary.latest?.snapshotId).toBe("snapshot-over");
  });
});
