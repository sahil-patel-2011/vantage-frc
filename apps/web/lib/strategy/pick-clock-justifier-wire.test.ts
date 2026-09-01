import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import type { PickClockRecommendation, PickClockResult } from "./pick-clock";
import {
  pickClockJustifierTeamKeys,
  wirePickClockJustifications,
} from "./pick-clock-justifier-wire";

const ORG = "22222222-2222-4222-8222-222222222222";
const PICK_LIST = "33333333-3333-4333-8333-333333333333";
const ENTRY_A = "44444444-4444-4444-8444-444444444444";
const ENTRY_B = "55555555-5555-4555-8555-555555555555";

function rec(
  partial: Partial<PickClockRecommendation> & Pick<PickClockRecommendation, "teamKey">,
): PickClockRecommendation {
  return {
    teamNumber: null,
    nickname: null,
    suggestedTier: null,
    listRank: null,
    listName: null,
    headline: `Team ${partial.teamKey}`,
    reasons: [{ label: "Event rank #3", tone: "neutral" }],
    epa: null,
    autoEpa: null,
    endgameEpa: null,
    rank: null,
    record: null,
    reliability: null,
    foulRate: null,
    scoutSample: 0,
    epaDrift: null,
    ...partial,
  };
}

function clock(partial: Partial<PickClockResult> = {}): PickClockResult {
  return {
    recommendation: rec({ teamKey: "frc254", headline: "#1 on Alliance" }),
    alternates: [rec({ teamKey: "frc118", headline: "#2 on Alliance", reasons: [{ label: "EPA 12.1", tone: "neutral" }] })],
    availableCount: 4,
    excludedCount: 1,
    ...partial,
  };
}

function mockClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount: number }): PoolClient {
  return {
    query: vi.fn((sql: string, params: unknown[] = []) => Promise.resolve(handler(sql, params))),
  } as unknown as PoolClient;
}

describe("pickClockJustifierTeamKeys", () => {
  it("collects unique recommendation and alternate keys and skips a null recommendation", () => {
    expect(pickClockJustifierTeamKeys(clock())).toEqual(["frc254", "frc118"]);
    expect(
      pickClockJustifierTeamKeys({
        recommendation: null,
        alternates: [rec({ teamKey: "frc1678" }), rec({ teamKey: "frc1678" })],
      }),
    ).toEqual(["frc1678"]);
    expect(pickClockJustifierTeamKeys({ recommendation: null, alternates: [] })).toEqual([]);
  });
});

describe("wirePickClockJustifications", () => {
  it("overlays stored justifier reasons on the recommendation and matching alternates", async () => {
    const client = mockClient((sql) => {
      if (sql.includes("LEFT JOIN picklist_justifier_justifications j")) {
        return {
          rows: [
            {
              pickListEntryId: ENTRY_A,
              teamKey: "frc254",
              rationale: "Team 254 is ranked #1 (first) on this pick list.",
              sources: [{ kind: "hard_metric", label: "TBA (tba)", detail: "EPA 45.2 · rank 3 · 8-1-0" }],
              contradictionFlagged: false,
              contradictionReason: null,
              createdAt: "2026-03-14T12:00:00.000Z",
            },
            {
              pickListEntryId: ENTRY_B,
              teamKey: "frc118",
              rationale: "Team 118 is ranked #2.",
              sources: [],
              contradictionFlagged: false,
              contradictionReason: null,
              createdAt: "2026-03-14T12:00:00.000Z",
            },
          ],
          rowCount: 2,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const result = await wirePickClockJustifications(client, clock(), {
      orgId: ORG,
      eventKey: "2026casj",
      pickListId: PICK_LIST,
    });

    expect(result.recommendation?.reasons[0]?.label).toMatch(/Team 254 is ranked #1/);
    expect(result.alternates[0]?.reasons[0]?.label).toMatch(/Team 118 is ranked #2/);
    expect(result.availableCount).toBe(4);
    expect(result.excludedCount).toBe(1);
  });

  it("leaves teams without a stored row unchanged and never invents a why", async () => {
    const original = clock({
      alternates: [rec({ teamKey: "frc118", reasons: [{ label: "High reliability 90", tone: "strong" }] })],
    });
    const client = mockClient((sql) => {
      if (sql.includes("LEFT JOIN picklist_justifier_justifications j")) {
        return {
          rows: [
            {
              pickListEntryId: ENTRY_A,
              teamKey: "frc254",
              rationale: "Team 254 is ranked #1 (first) on this pick list.",
              sources: [],
              contradictionFlagged: false,
              contradictionReason: null,
              createdAt: "2026-03-14T12:00:00.000Z",
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const result = await wirePickClockJustifications(client, original, {
      orgId: ORG,
      pickListId: PICK_LIST,
    });

    expect(result.recommendation?.reasons[0]?.label).toMatch(/Team 254 is ranked #1/);
    expect(result.alternates[0]?.reasons).toEqual([{ label: "High reliability 90", tone: "strong" }]);
    expect(JSON.stringify(result)).not.toMatch(/DEMO/i);
    expect(result.alternates[0]?.reasons.some((r) => /invent|fabricat/i.test(r.label))).toBe(false);
  });

  it("returns the clock unchanged when no stored rows exist", async () => {
    const original = clock();
    const client = mockClient(() => ({ rows: [], rowCount: 0 }));

    const result = await wirePickClockJustifications(client, original, {
      orgId: ORG,
      eventKey: "2026casj",
      pickListId: PICK_LIST,
    });

    expect(result).toEqual(original);
    expect(result.recommendation?.reasons).toEqual([{ label: "Event rank #3", tone: "neutral" }]);
  });

  it("skips the loader when the clock has no teams", async () => {
    const empty = clock({ recommendation: null, alternates: [], availableCount: 0, excludedCount: 3 });
    const query = vi.fn();
    const client = { query } as unknown as PoolClient;

    const result = await wirePickClockJustifications(client, empty, { orgId: ORG, pickListId: PICK_LIST });
    expect(result).toBe(empty);
    expect(query).not.toHaveBeenCalled();
  });

  it("asks the loader only for the clock's team keys and skips pick-list resolve when id is known", async () => {
    const queries: { sql: string; params: unknown[] }[] = [];
    const client = mockClient((sql, params) => {
      queries.push({ sql, params });
      return { rows: [], rowCount: 0 };
    });

    await wirePickClockJustifications(client, clock(), {
      orgId: ORG,
      eventKey: "2026casj",
      pickListId: PICK_LIST,
    });

    expect(queries.some((q) => q.sql.includes("FROM pick_lists") && !q.sql.includes("pick_list_entries"))).toBe(
      false,
    );
    const load = queries.find((q) => q.sql.includes("LEFT JOIN picklist_justifier_justifications j"));
    expect(load?.params[0]).toBe(ORG);
    expect(load?.params[1]).toBe(PICK_LIST);
    expect(load?.params[2]).toEqual(["frc254", "frc118"]);
  });
});
