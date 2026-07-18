import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeAwardTrackerView } from "./compute-award-tracker";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeAwardTrackerView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeAwardTrackerView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view with summary and upcoming-deadline ordering built from submissions", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM award_tracker_submissions") && sql.includes("SELECT id")) {
        return {
          rows: [
            {
              id: "sub-1",
              awardType: "chairmans",
              awardName: "Chairman's Award",
              eventName: "Week 3 Regional",
              eventDate: "2026-03-14",
              submissionDeadline: "2026-01-10",
              status: "won",
              submittedOn: "2026-01-08",
              ownerNote: null,
              notes: null,
              seasonYear: 2026,
            },
            {
              id: "sub-2",
              awardType: "impact",
              awardName: "Impact Award",
              eventName: "Week 5 District",
              eventDate: "2026-03-28",
              submissionDeadline: "2026-02-01",
              status: "planning",
              submittedOn: null,
              ownerNote: "Assigned to Jamie",
              notes: null,
              seasonYear: 2026,
            },
          ],
        };
      }
      if (sql.includes("DISTINCT season_year")) {
        return { rows: [{ seasonYear: 2026 }] };
      }
      return { rows: [] };
    });

    const view = await computeAwardTrackerView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.submissions).toHaveLength(2);
    expect(view.summary.total).toBe(2);
    expect(view.summary.wonCount).toBe(1);
    // The still-open planning submission has the nearer deadline and should sort first.
    expect(view.upcoming[0]?.id).toBe("sub-2");
    expect(view.seasons).toContain(2026);
  });
});
