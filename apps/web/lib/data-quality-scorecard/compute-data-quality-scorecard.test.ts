import { describe, expect, it, vi } from "vitest";
import { computeDataQualityScorecardView } from "./compute-data-quality-scorecard";

type Query = { text: string; values?: unknown[] };

function mockClient(handler: (query: Query) => { rows: unknown[] }) {
  const calls: Query[] = [];
  const query = vi.fn(async (text: string, values?: unknown[]) => {
    calls.push({ text, values });
    return handler({ text, values });
  });
  return { query, calls } as unknown as import("@neondatabase/serverless").PoolClient & { calls: Query[] };
}

describe("computeDataQualityScorecardView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = mockClient(() => ({ rows: [] }));
    const view = await computeDataQualityScorecardView(client, {
      userId: "user-1",
      requestedOrg: null,
      seasonYear: 2026,
    });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns setup_required when the org has no checks logged in any season", async () => {
    const client = mockClient(({ text }) => {
      if (text.includes("FROM memberships")) {
        return { rows: [{ orgId: "org-1", teamNumber: 254 }] };
      }
      if (text.includes("ORDER BY check_date DESC")) {
        return { rows: [] };
      }
      if (text.includes("SELECT DISTINCT season_year")) {
        return { rows: [] };
      }
      return { rows: [] };
    });
    const view = await computeDataQualityScorecardView(client, {
      userId: "user-1",
      requestedOrg: "org-1",
      seasonYear: 2026,
    });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBe("org-1");
    }
  });

  it("computes a live scorecard summary from logged checks", async () => {
    const client = mockClient(({ text }) => {
      if (text.includes("FROM memberships")) {
        return { rows: [{ orgId: "org-1", teamNumber: 254 }] };
      }
      if (text.includes("ORDER BY check_date DESC")) {
        return {
          rows: [
            {
              id: "chk-1",
              eventKey: "2026casj",
              matchKey: "qm1",
              scoutName: "Alice",
              checkDate: "2026-02-10",
              expectedDataPoints: 20,
              capturedDataPoints: 18,
              crossChecked: true,
              agreement: true,
              deviationScore: 0.1,
              seasonYear: 2026,
              notes: null,
            },
            {
              id: "chk-2",
              eventKey: "2026casj",
              matchKey: "qm2",
              scoutName: "Bob",
              checkDate: "2026-02-17",
              expectedDataPoints: 20,
              capturedDataPoints: 10,
              crossChecked: true,
              agreement: false,
              deviationScore: 0.4,
              seasonYear: 2026,
              notes: null,
            },
          ],
        };
      }
      if (text.includes("SELECT DISTINCT season_year")) {
        return { rows: [{ seasonYear: 2026 }] };
      }
      return { rows: [] };
    });
    const view = await computeDataQualityScorecardView(client, {
      userId: "user-1",
      requestedOrg: "org-1",
      seasonYear: 2026,
    });
    expect(view.status).toBe("live");
    if (view.status !== "live") return;
    expect(view.summary.totalChecks).toBe(2);
    expect(view.summary.coverage).toBeCloseTo(28 / 40, 3);
    expect(view.summary.disagreementRate).toBeCloseTo(0.5, 3);
    expect(view.scorecard.score).toBeGreaterThan(0);
    expect(view.scorecard.grade).toBeDefined();
    expect(view.summary.byEvent[0]?.eventKey).toBe("2026casj");
    expect(view.summary.byScout.map((s) => s.scoutName).sort()).toEqual(["Alice", "Bob"]);
  });
});
