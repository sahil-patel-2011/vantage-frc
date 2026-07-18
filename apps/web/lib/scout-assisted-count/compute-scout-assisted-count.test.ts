import { describe, expect, it, vi } from "vitest";
import { computeScoutAssistedCountView } from "./compute-scout-assisted-count";

type Row<T> = { rows: T[] };

function makeClient(handlers: {
  membership?: Row<{ orgId: string; teamNumber: number | null }>;
  sessions?: Row<Record<string, unknown>>;
  taps?: Row<Record<string, unknown>>;
}) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("FROM memberships")) return handlers.membership ?? { rows: [] };
    if (sql.includes("FROM scout_assisted_count_sessions")) return handlers.sessions ?? { rows: [] };
    if (sql.includes("FROM scout_assisted_count_taps")) return handlers.taps ?? { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  return { query } as unknown as import("@neondatabase/serverless").PoolClient;
}

describe("computeScoutAssistedCountView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient({ membership: { rows: [] } });
    const view = await computeScoutAssistedCountView(client, { userId: "u1", requestedOrg: null });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("summarizes sessions and taps for a live org", async () => {
    const client = makeClient({
      membership: { rows: [{ orgId: "org-1", teamNumber: 254 }] },
      sessions: {
        rows: [
          {
            id: "sess-1",
            metricKey: "cycles",
            matchKey: "2026casj_qm12",
            teamKey: "frc254",
            label: "Opponent cycles",
            status: "open",
            tapCount: 3,
            startedBy: "u1",
            startedAt: "2026-02-01T10:00:00.000Z",
            closedAt: null,
          },
          {
            id: "sess-2",
            metricKey: "fouls",
            matchKey: null,
            teamKey: null,
            label: "Fouls tally",
            status: "closed",
            tapCount: 1,
            startedBy: "u1",
            startedAt: "2026-02-01T09:00:00.000Z",
            closedAt: "2026-02-01T09:30:00.000Z",
          },
        ],
      },
      taps: {
        rows: [
          { id: "t1", sessionId: "sess-1", delta: 1, tappedBy: "u1", tappedAt: "2026-02-01T10:01:00.000Z" },
          { id: "t2", sessionId: "sess-1", delta: 1, tappedBy: "u1", tappedAt: "2026-02-01T10:02:00.000Z" },
          { id: "t3", sessionId: "sess-1", delta: 1, tappedBy: "u1", tappedAt: "2026-02-01T10:03:00.000Z" },
          { id: "t4", sessionId: "sess-2", delta: 1, tappedBy: "u1", tappedAt: "2026-02-01T09:10:00.000Z" },
        ],
      },
    });

    const view = await computeScoutAssistedCountView(client, { userId: "u1", requestedOrg: "org-1" });
    expect(view.status).toBe("live");
    if (view.status !== "live") return;
    expect(view.orgId).toBe("org-1");
    expect(view.teamNumber).toBe(254);
    expect(view.sessions).toHaveLength(2);
    const session1 = view.sessions.find((s) => s.id === "sess-1");
    expect(session1?.taps).toHaveLength(3);
    expect(session1?.tapCount).toBe(3);
    expect(view.summary.totalSessions).toBe(2);
    expect(view.summary.openSessions).toBe(1);
    expect(view.summary.closedSessions).toBe(1);
    expect(view.summary.totalTaps).toBe(4);
  });
});
