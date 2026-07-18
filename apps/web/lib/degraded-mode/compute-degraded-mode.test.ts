import { describe, expect, it, vi } from "vitest";
import { computeDegradedModeView } from "./compute-degraded-mode";

type QueryCall = { text: string; values: unknown[] };

function makeClient(rows: {
  membership?: Record<string, unknown>[];
  cache?: Record<string, unknown>[];
  health?: Record<string, unknown>[];
  cursors?: Record<string, unknown>[];
  freshness?: Record<string, unknown>[];
  acknowledgments?: Record<string, unknown>[];
}) {
  const calls: QueryCall[] = [];
  const query = vi.fn(async (text: string, values: unknown[] = []) => {
    calls.push({ text, values });
    if (text.includes("FROM memberships")) return { rows: rows.membership ?? [] };
    if (text.includes("FROM matches_ref") || text.includes("EXISTS(SELECT 1 FROM matches_ref")) {
      return { rows: rows.cache ?? [{ ok: false }] };
    }
    if (text.includes("FROM data_source_health")) return { rows: rows.health ?? [] };
    if (text.includes("app_reference_cursor_summary")) return { rows: rows.cursors ?? [] };
    if (text.includes("FROM tba_cache_freshness")) return { rows: rows.freshness ?? [] };
    if (text.includes("FROM degraded_mode_acknowledgments")) return { rows: rows.acknowledgments ?? [] };
    return { rows: [] };
  });
  return { query } as unknown as import("@neondatabase/serverless").PoolClient;
}

describe("computeDegradedModeView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient({ membership: [] });
    const view = await computeDegradedModeView(client, { userId: "u1", requestedOrg: null });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view with a degraded banner and fallbacks when TBA is unhealthy", async () => {
    const client = makeClient({
      membership: [{ orgId: "org-1", teamNumber: 254 }],
      cache: [{ ok: true }],
      health: [
        {
          source: "tba",
          status: "degraded",
          consecutiveFailures: 3,
          lastSuccessAt: "2026-07-17T12:00:00Z",
          lastFailureAt: "2026-07-18T01:00:00Z",
          details: { error: "timeout" },
        },
      ],
      acknowledgments: [],
    });

    const view = await computeDegradedModeView(client, { userId: "u1", requestedOrg: "org-1" });
    expect(view.status).toBe("live");
    if (view.status !== "live") return;
    expect(view.orgId).toBe("org-1");
    expect(view.teamNumber).toBe(254);
    expect(view.health.mode).toBe("degraded");
    expect(view.showBanner).toBe(true);
    expect(view.fallbacks.length).toBeGreaterThan(0);
    expect(view.activeAcknowledgment).toBeNull();
  });

  it("surfaces an unresolved acknowledgment matching the current mode as active", async () => {
    const client = makeClient({
      membership: [{ orgId: "org-2", teamNumber: 118 }],
      cache: [{ ok: true }],
      health: [
        {
          source: "tba",
          status: "degraded",
          consecutiveFailures: 1,
          lastSuccessAt: "2026-07-17T12:00:00Z",
          lastFailureAt: "2026-07-18T01:00:00Z",
          details: { error: "500" },
        },
      ],
      acknowledgments: [
        {
          id: "ack-1",
          source: "tba",
          mode: "degraded",
          note: "Known issue, working from cache",
          acknowledgedBy: "u1",
          acknowledgedAt: "2026-07-18T01:05:00Z",
          resolvedAt: null,
        },
      ],
    });

    const view = await computeDegradedModeView(client, { userId: "u1", requestedOrg: "org-2" });
    expect(view.status).toBe("live");
    if (view.status !== "live") return;
    expect(view.activeAcknowledgment?.id).toBe("ack-1");
    expect(view.recentAcknowledgments).toHaveLength(1);
  });
});
