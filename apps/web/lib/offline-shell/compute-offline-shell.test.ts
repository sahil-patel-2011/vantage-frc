import { describe, expect, it } from "vitest";
import { computeOfflineShellView } from "./compute-offline-shell";

type QueryCall = { sql: string; params: unknown[] };

function fakeClient(rowsByStep: unknown[][]) {
  const calls: QueryCall[] = [];
  let step = 0;
  return {
    calls,
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const rows = rowsByStep[step] ?? [];
      step += 1;
      return { rows, rowCount: rows.length };
    },
  } as unknown as import("@neondatabase/serverless").PoolClient;
}

describe("computeOfflineShellView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = fakeClient([[]]);
    const view = await computeOfflineShellView(client, { userId: "user-1", requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live summary computed from recorded cache events", async () => {
    const client = fakeClient([
      [{ orgId: "org-1", teamNumber: 254 }],
      [
        {
          id: "evt-1",
          deviceLabel: "Scout tablet A",
          routes: ["/scouting", "/schedule"],
          routeCount: 2,
          cacheBytes: 1024,
          networkStatus: "offline",
          notes: "Cold launch verified with airplane mode",
          occurredAt: "2026-07-10T12:00:00.000Z",
        },
        {
          id: "evt-2",
          deviceLabel: "Scout tablet B",
          routes: ["/scouting"],
          routeCount: 1,
          cacheBytes: 512,
          networkStatus: "online",
          notes: null,
          occurredAt: "2026-07-11T09:00:00.000Z",
        },
      ],
    ]);

    const view = await computeOfflineShellView(client, { userId: "user-1", requestedOrg: "org-1" });

    expect(view.status).toBe("live");
    if (view.status !== "live") return;
    expect(view.orgId).toBe("org-1");
    expect(view.teamNumber).toBe(254);
    expect(view.events).toHaveLength(2);
    expect(view.summary.totalEvents).toBe(2);
    expect(view.summary.deviceCount).toBe(2);
    expect(view.summary.offlineVerifiedCount).toBe(1);
    expect(view.summary.routesCovered).toContain("/scouting");
    expect(view.readiness.score).toBeGreaterThan(0);
    expect(view.readiness.tier).not.toBe("not_ready");
  });
});
