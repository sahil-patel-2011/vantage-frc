import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeCrossTeamScrimView } from "./compute-cross-team-scrim";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeCrossTeamScrimView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeCrossTeamScrimView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view with summary and upcoming ordering built from invites", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM cross_team_scrim_invites") && sql.includes("SELECT id")) {
        return {
          rows: [
            {
              id: "invite-1",
              partnerTeamNumber: 118,
              partnerTeamName: "Robonauts",
              contactName: "Jamie",
              contactEmail: "jamie@example.com",
              proposedDate: "2026-09-01",
              location: "Team 118 shop",
              status: "proposed",
              dataShareScope: "match_results",
              dataShareAgreed: false,
              notes: null,
              seasonYear: 2026,
            },
            {
              id: "invite-2",
              partnerTeamNumber: 148,
              partnerTeamName: "Robowranglers",
              contactName: null,
              contactEmail: null,
              proposedDate: "2026-08-15",
              location: "Neutral field",
              status: "accepted",
              dataShareScope: "full_scouting",
              dataShareAgreed: true,
              notes: "Bring extra batteries",
              seasonYear: 2026,
            },
            {
              id: "invite-3",
              partnerTeamNumber: 254,
              partnerTeamName: "The Cheesy Poofs",
              contactName: null,
              contactEmail: null,
              proposedDate: null,
              location: null,
              status: "declined",
              dataShareScope: "none",
              dataShareAgreed: false,
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

    const view = await computeCrossTeamScrimView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.invites).toHaveLength(3);
    expect(view.summary.total).toBe(3);
    expect(view.summary.agreedDataShareCount).toBe(1);
    // The earlier-dated open invite (invite-2, Aug 15) should sort before invite-1 (Sep 1);
    // the declined invite-3 is excluded from "upcoming" entirely.
    expect(view.upcoming.map((i) => i.id)).toEqual(["invite-2", "invite-1"]);
    expect(view.seasons).toContain(2026);
  });
});
