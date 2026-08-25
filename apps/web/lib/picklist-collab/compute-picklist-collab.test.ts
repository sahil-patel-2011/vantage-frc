import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computePicklistCollabView } from "./compute-picklist-collab";

// The collaborative view is now a projection of the ONE pick list (pick_lists /
// pick_list_entries / pick_list_entry_votes, migration 0454) — these mocks speak the spine.

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

const LIST_ROW = {
  id: LIST,
  orgId: ORG,
  eventKey: "2026miket",
  name: "Week 3 Regional",
  seasonYear: 2026,
  status: "open",
  source: "picklist_collab",
  boardState: {},
  createdBy: USER,
  updatedBy: USER,
  updatedByName: "Priya",
  updatedAt: "2026-03-01T00:00:00.000Z",
  revision: 4,
};

function spineEntry(overrides: Record<string, unknown>) {
  return {
    pickListId: LIST,
    nickname: null,
    tier: "first",
    notes: null,
    addedBy: USER,
    updatedBy: USER,
    updatedByName: "Priya",
    updatedAt: "2026-03-01T00:00:00.000Z",
    revision: 1,
    justification: null,
    justificationSources: [],
    justificationContradiction: false,
    justificationReason: null,
    justificationGeneratedAt: null,
    draftedAllianceSeed: null,
    draftedPickSlot: null,
    draftedAt: null,
    boardRationale: "",
    ...overrides,
  };
}

describe("computePicklistCollabView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient(() => ({ rows: [] }));

    const view = await computePicklistCollabView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns setup_required when the org has no pick lists yet", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [{ orgId: ORG, teamNumber: 254, eventKey: null }] };
      return { rows: [] };
    });

    const view = await computePicklistCollabView(client, { userId: USER, requestedOrg: ORG });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBe(ORG);
      // The empty state points at the shared list, never at a fabricated one.
      expect(view.steps.some((step) => step.href === "/picklist-collab")).toBe(true);
    }
  });

  it("projects the shared spine into the collaborative view with weighted vote scores", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254, eventKey: "2026miket" }] };
      }
      if (sql.includes('AS "entryCount"')) return { rows: [{ ...LIST_ROW, entryCount: "2" }] };
      if (sql.includes("FROM pick_lists p")) return { rows: [LIST_ROW] };
      if (sql.includes("FROM pick_list_entries e")) {
        return {
          rows: [
            spineEntry({ id: ENTRY_1, teamKey: "frc1114", teamNumber: 1114, nickname: "Simbotics", rank: 1, bucket: "first_pick" }),
            spineEntry({ id: ENTRY_2, teamKey: "frc254", teamNumber: 254, nickname: "The Cheesy Poofs", rank: 2, bucket: "first_pick" }),
          ],
        };
      }
      if (sql.includes("FROM pick_list_entry_votes v")) {
        return {
          rows: [
            { id: "vote-1", entryId: ENTRY_1, voterId: USER, voterName: "Priya", weight: "1.00", rankSuggestion: 1, comment: null, updatedAt: "2026-03-01T00:00:00.000Z" },
            { id: "vote-2", entryId: ENTRY_2, voterId: USER, voterName: "Priya", weight: "2.00", rankSuggestion: 1, comment: null, updatedAt: "2026-03-01T00:00:00.000Z" },
            { id: "vote-3", entryId: ENTRY_2, voterId: USER_2, voterName: "Sam", weight: "1.00", rankSuggestion: 2, comment: "Strong defense", updatedAt: "2026-03-01T00:00:00.000Z" },
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
    expect(view.activeList?.id).toBe(LIST);
    expect(view.activeList?.eventKey).toBe("2026miket");

    // Team 254 has a heavier combined vote weight (3.0) than 1114 (1.0), so it sorts first
    // within the "first_pick" tier despite entering with a later rank.
    expect(view.entries[0]?.teamNumber).toBe(254);
    expect(view.entries[0]?.weightedScore).toBe(3);
    expect(view.entries[0]?.averageRankSuggestion).toBeCloseTo(1.33, 1);
    expect(view.entries[1]?.weightedScore).toBe(1);
  });

  it("shows no EPA role when the event has no cached metrics — never a fabricated one", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254, eventKey: "2026miket" }] };
      }
      if (sql.includes('AS "entryCount"')) return { rows: [{ ...LIST_ROW, entryCount: "1" }] };
      if (sql.includes("FROM pick_lists p")) return { rows: [LIST_ROW] };
      if (sql.includes("FROM pick_list_entries e")) {
        return {
          rows: [spineEntry({ id: ENTRY_1, teamKey: "frc1114", teamNumber: 1114, rank: 1, bucket: "unranked" })],
        };
      }
      return { rows: [] };
    });

    const view = await computePicklistCollabView(client, { userId: USER, requestedOrg: ORG, listId: LIST });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.entries[0]?.epaRole).toBeNull();
    expect(view.entries[0]?.epaTotal).toBeNull();
    expect(view.entries[0]?.weightedScore).toBe(0);
  });
});
