import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { averageConfidence, buildRationaleText, detectContradiction, winRate } from ".";
import { computePicklistJustifierView, generatePicklistJustifications } from "./compute-picklist-justifier";
import type { JustificationInput } from "./types";

const USER = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const PICK_LIST = "33333333-3333-4333-8333-333333333333";
const ENTRY_A = "44444444-4444-4444-8444-444444444444";
const ENTRY_B = "55555555-5555-4555-8555-555555555555";

function mockClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount: number }): PoolClient {
  return {
    query: vi.fn((sql: string, params: unknown[] = []) => Promise.resolve(handler(sql, params))),
  } as unknown as PoolClient;
}

describe("picklist-justifier pure helpers", () => {
  it("computes win rate including ties as half-wins", () => {
    expect(winRate(2, 2, 0)).toBeCloseTo(0.5, 5);
    expect(winRate(0, 0, 0)).toBeNull();
    expect(winRate(1, 3, 0)).toBeCloseTo(0.25, 5);
  });

  it("averages scout confidence across high/normal/low", () => {
    expect(averageConfidence(["high", "low"])).toBeCloseTo(0.5, 5);
    expect(averageConfidence([])).toBeNull();
  });

  it("flags a contradiction when confident scouting outruns a weak TBA record", () => {
    const input: JustificationInput = {
      teamKey: "frc254",
      teamNumber: 254,
      rank: 1,
      tier: "first",
      tba: { epaTotal: 10, rank: 20, wins: 1, losses: 8, ties: 0, source: "tba" },
      scout: { entryCount: 4, avgConfidenceScore: 0.9, lowConfidenceCount: 0 },
    };
    const contradiction = detectContradiction(input);
    expect(contradiction.flagged).toBe(true);
    expect(contradiction.reason).toMatch(/win rate/);
    expect(buildRationaleText(input, contradiction)).toMatch(/Contradiction flagged/);
  });

  it("does not flag when scouting is low-confidence or TBA data is missing", () => {
    const noTba: JustificationInput = {
      teamKey: "frc254",
      teamNumber: 254,
      rank: 1,
      tier: null,
      tba: null,
      scout: { entryCount: 3, avgConfidenceScore: 0.9, lowConfidenceCount: 0 },
    };
    expect(detectContradiction(noTba).flagged).toBe(false);

    const lowConfidence: JustificationInput = {
      ...noTba,
      tba: { epaTotal: 5, rank: 30, wins: 0, losses: 6, ties: 0, source: "tba" },
      scout: { entryCount: 3, avgConfidenceScore: 0.2, lowConfidenceCount: 3 },
    };
    expect(detectContradiction(lowConfidence).flagged).toBe(false);
  });
});

describe("computePicklistJustifierView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = mockClient(() => ({ rows: [], rowCount: 0 }));
    const view = await computePicklistJustifierView(client, { userId: USER, requestedOrg: null });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
      expect(view.steps[0]?.href).toBe("/workspace");
      expect(view.steps.some((s) => s.href.includes("/competition?tab=strategy"))).toBe(true);
      expect(view.steps.every((s) => !s.href.toLowerCase().includes("demo"))).toBe(true);
    }
  });

  it("returns a live empty view when the org has no pick lists yet", async () => {
    const client = mockClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [{ orgId: ORG }], rowCount: 1 };
      if (sql.includes("FROM pick_lists pl")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
    const view = await computePicklistJustifierView(client, { userId: USER, requestedOrg: ORG });
    expect(view.status).toBe("live");
    if (view.status === "live") {
      expect(view.orgId).toBe(ORG);
      expect(view.pickLists).toEqual([]);
      expect(view.selectedPickListId).toBeNull();
      expect(view.entries).toEqual([]);
    }
  });

  it("returns a live view combining TBA metrics and scout summaries per slot", async () => {
    const client = mockClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [{ orgId: ORG }], rowCount: 1 };
      if (sql.includes("FROM pick_lists pl")) {
        return {
          rows: [{ id: PICK_LIST, name: "Championship A", eventKey: "2026casj", entryCount: "1", updatedAt: new Date().toISOString() }],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM pick_list_entries pe")) {
        return {
          rows: [{ id: ENTRY_A, teamKey: "frc254", teamNumber: 254, rank: 1, tier: "first", notes: null }],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM team_event_metrics")) {
        return {
          rows: [{ teamKey: "frc254", epaTotal: 45.2, rank: 3, wins: 8, losses: 1, ties: 0, source: "tba" }],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM match_scout_entries")) {
        return { rows: [{ teamKey: "frc254", confidence: "high" }, { teamKey: "frc254", confidence: "normal" }], rowCount: 2 };
      }
      if (sql.includes("FROM picklist_justifier_justifications")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });

    const view = await computePicklistJustifierView(client, { userId: USER, requestedOrg: ORG });
    expect(view.status).toBe("live");
    if (view.status === "live") {
      expect(view.eventKey).toBe("2026casj");
      expect(view.entries).toHaveLength(1);
      expect(view.entries[0]?.teamNumber).toBe(254);
      expect(view.entries[0]?.tbaAvailable).toBe(true);
      expect(view.entries[0]?.scoutEntryCount).toBe(2);
      expect(view.entries[0]?.rationale).toBeNull();
    }
  });
});

describe("generatePicklistJustifications", () => {
  it("generates and persists source-cited rationale, metering usage via the local_cli path", async () => {
    const queries: string[] = [];
    const client = mockClient((sql) => {
      queries.push(sql);
      if (sql.includes("FROM pick_lists WHERE id")) {
        return { rows: [{ id: PICK_LIST, eventKey: "2026casj" }], rowCount: 1 };
      }
      if (sql.includes("FROM pick_list_entries pe")) {
        return {
          rows: [
            { id: ENTRY_A, teamKey: "frc254", teamNumber: 254, rank: 1, tier: "first", notes: null },
            { id: ENTRY_B, teamKey: "frc118", teamNumber: 118, rank: 2, tier: "second", notes: null },
          ],
          rowCount: 2,
        };
      }
      if (sql.includes("FROM team_event_metrics")) {
        return {
          rows: [
            { teamKey: "frc254", epaTotal: 45.2, rank: 3, wins: 8, losses: 1, ties: 0, source: "tba" },
            { teamKey: "frc118", epaTotal: 12.1, rank: 40, wins: 1, losses: 8, ties: 0, source: "tba" },
          ],
          rowCount: 2,
        };
      }
      if (sql.includes("FROM match_scout_entries")) {
        return {
          rows: [
            { teamKey: "frc254", confidence: "high" },
            { teamKey: "frc118", confidence: "high" },
            { teamKey: "frc118", confidence: "normal" },
          ],
          rowCount: 3,
        };
      }
      if (sql.includes("INSERT INTO ai_usage_events")) return { rows: [], rowCount: 1 };
      if (sql.includes("INSERT INTO picklist_justifier_justifications")) return { rows: [], rowCount: 1 };
      if (sql.includes("FROM memberships")) return { rows: [{ orgId: ORG }], rowCount: 1 };
      if (sql.includes("FROM pick_lists pl")) {
        return {
          rows: [{ id: PICK_LIST, name: "Championship A", eventKey: "2026casj", entryCount: "2", updatedAt: new Date().toISOString() }],
          rowCount: 1,
        };
      }
      if (sql.includes("SELECT pick_list_entry_id")) {
        return {
          rows: [
            {
              pickListEntryId: ENTRY_B,
              rationale: "Team 118 is ranked #2 (Second).",
              sources: [],
              contradictionFlagged: true,
              contradictionReason: "Scouts logged this pick with average-or-higher confidence, but TBA's official record shows a low win rate.",
              createdAt: new Date().toISOString(),
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const view = await generatePicklistJustifications(client, { orgId: ORG, userId: USER, pickListId: PICK_LIST });

    expect(view.status).toBe("live");
    if (view.status === "live") {
      expect(view.entries).toHaveLength(2);
      const flagged = view.entries.find((e) => e.teamKey === "frc118");
      expect(flagged?.contradiction?.flagged).toBe(true);
    }
    expect(queries.some((q) => q.includes("INSERT INTO ai_usage_events"))).toBe(true);
    expect(queries.some((q) => q.includes("INSERT INTO picklist_justifier_justifications"))).toBe(true);
  });

  it("throws instead of fabricating a justification when the pick list has no entries", async () => {
    const client = mockClient((sql) => {
      if (sql.includes("FROM pick_lists WHERE id")) return { rows: [{ id: PICK_LIST, eventKey: "2026casj" }], rowCount: 1 };
      if (sql.includes("FROM pick_list_entries pe")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
    await expect(
      generatePicklistJustifications(client, { orgId: ORG, userId: USER, pickListId: PICK_LIST }),
    ).rejects.toThrow(/no entries/);
  });
});
