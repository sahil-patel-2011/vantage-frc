import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computePicklistCollabView } from "./compute-picklist-collab";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const USER_2 = "22222222-2222-4222-8222-222222222222";
const LIST = "33333333-3333-4333-8333-333333333333";
const ENTRY_1 = "44444444-4444-4444-8444-444444444444";
const ENTRY_2 = "55555555-5555-4555-8555-555555555555";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computePicklistCollabView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computePicklistCollabView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns setup_required when the org has no pick lists yet", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      if (sql.includes("FROM picklist_collab_lists")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computePicklistCollabView(client, { userId: USER, requestedOrg: ORG });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBe(ORG);
    }
  });

  it("returns a live view with weighted vote scores and tier ordering built from entries", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      if (sql.includes("FROM picklist_collab_lists")) {
        return {
          rows: [
            {
              id: LIST,
              eventKey: "2026miket",
              name: "Week 3 Regional",
              seasonYear: 2026,
              status: "open",
              createdBy: USER,
              updatedAt: "2026-03-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM picklist_collab_entries") && sql.includes("SELECT id")) {
        return {
          rows: [
            {
              id: ENTRY_1,
              teamNumber: 1114,
              teamName: "Simbotics",
              tier: "first_pick",
              position: 1,
              note: null,
              addedBy: USER,
            },
            {
              id: ENTRY_2,
              teamNumber: 254,
              teamName: "The Cheesy Poofs",
              tier: "first_pick",
              position: 2,
              note: null,
              addedBy: USER,
            },
          ],
        };
      }
      if (sql.includes("FROM picklist_collab_votes")) {
        return {
          rows: [
            {
              id: "vote-1",
              entryId: ENTRY_1,
              voterId: USER,
              weight: "1.00",
              rankSuggestion: 1,
              comment: null,
              updatedAt: "2026-03-01T00:00:00.000Z",
            },
            {
              id: "vote-2",
              entryId: ENTRY_2,
              voterId: USER,
              weight: "2.00",
              rankSuggestion: 1,
              comment: null,
              updatedAt: "2026-03-01T00:00:00.000Z",
            },
            {
              id: "vote-3",
              entryId: ENTRY_2,
              voterId: USER_2,
              weight: "1.00",
              rankSuggestion: 2,
              comment: "Strong defense",
              updatedAt: "2026-03-01T00:00:00.000Z",
            },
          ],
        };
      }
      return { rows: [] };
    });

    const view = await computePicklistCollabView(client, { userId: USER, requestedOrg: ORG, listId: LIST });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.entries).toHaveLength(2);
    expect(view.summary.totalEntries).toBe(2);
    expect(view.summary.totalVotes).toBe(3);
    expect(view.summary.totalVoters).toBe(2);

    // Team 254 has a heavier combined vote weight (3.0) than 1114 (1.0), so it sorts first
    // within the "first_pick" tier despite entering with a later manual position.
    expect(view.entries[0]?.teamNumber).toBe(254);
    expect(view.entries[0]?.weightedScore).toBe(3);
    expect(view.entries[0]?.averageRankSuggestion).toBeCloseTo(1.33, 1);
    expect(view.entries[1]?.teamNumber).toBe(1114);
  });
});
