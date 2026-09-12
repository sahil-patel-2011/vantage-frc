import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import {
  applyStoredJustificationToRecommendation,
  applyStoredJustificationsToPickClockResult,
  glanceableLabel,
  loadStoredJustificationsForPickClock,
  studentPickClockLabel,
  mergePickClockReasons,
  parseJustificationSources,
  pickClockReasonsFromJustification,
  storedJustificationFromEntry,
  type StoredPicklistJustification,
} from "./pick-clock-reasons";

const ORG = "22222222-2222-4222-8222-222222222222";
const PICK_LIST = "33333333-3333-4333-8333-333333333333";
const ENTRY_A = "44444444-4444-4444-8444-444444444444";

function stored(partial: Partial<StoredPicklistJustification> = {}): StoredPicklistJustification {
  return {
    pickListEntryId: ENTRY_A,
    teamKey: "frc254",
    rationale: "Team 254 is ranked #1 (first) on this pick list. TBA's official record shows an EPA of 45.2.",
    sources: [
      { kind: "hard_metric", label: "TBA (tba)", detail: "EPA 45.2 · rank 3 · 8-1-0" },
      { kind: "scout_observation", label: "Team scouting", detail: "4 scouted matches · 90% avg confidence" },
    ],
    contradictionFlagged: false,
    contradictionReason: null,
    generatedAt: "2026-03-14T12:00:00.000Z",
    ...partial,
  };
}

function mockClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount: number }): PoolClient {
  return {
    query: vi.fn((sql: string, params: unknown[] = []) => Promise.resolve(handler(sql, params))),
  } as unknown as PoolClient;
}

describe("glanceableLabel", () => {
  it("returns the first sentence and never invents text", () => {
    expect(glanceableLabel(null)).toBeNull();
    expect(glanceableLabel("   ")).toBeNull();
    expect(glanceableLabel("Team 254 is ranked #1.")).toBe("Team 254 is ranked #1.");
    expect(glanceableLabel("Short. Extra sentence.")).toBe("Short.");
  });

  it("truncates long stored text instead of fabricating a shorter metric", () => {
    const long = "A".repeat(120);
    const label = glanceableLabel(long);
    expect(label?.endsWith("…")).toBe(true);
    expect(label?.length).toBeLessThanOrEqual(80);
    expect(label).not.toMatch(/EPA|DEMO/i);
  });
});

describe("parseJustificationSources", () => {
  it("keeps only persisted source-cited rows", () => {
    expect(parseJustificationSources(null)).toEqual([]);
    expect(parseJustificationSources("not-json")).toEqual([]);
    expect(
      parseJustificationSources([
        { kind: "hard_metric", label: "TBA (tba)", detail: "EPA 45.2" },
        { kind: "invented", label: "Fake", detail: "EPA 99" },
        { kind: "scout_observation", label: "  ", detail: "ignored" },
      ]),
    ).toEqual([{ kind: "hard_metric", label: "TBA (tba)", detail: "EPA 45.2" }]);
  });
});

describe("pickClockReasonsFromJustification", () => {
  it("surfaces the stored rationale and cited sources as clock reasons", () => {
    const reasons = pickClockReasonsFromJustification(stored());
    expect(reasons[0]?.tone).toBe("strong");
    expect(reasons[0]?.label).toMatch(/Team 254 is ranked #1/);
    expect(reasons.some((r) => /Official record: Rating 45\.2/.test(r.label) && r.tone === "neutral")).toBe(true);
    expect(reasons.some((r) => /Team scouting/.test(r.label) && r.tone === "strong")).toBe(true);
    expect(reasons).toHaveLength(3);
  });

  it("puts a stored contradiction first as caution and never invents a win rate", () => {
    const reasons = pickClockReasonsFromJustification(
      stored({
        contradictionFlagged: true,
        contradictionReason:
          "Scouts logged this pick with average-or-higher confidence, but TBA's official record shows a 11% win rate (1-8-0) at this event.",
      }),
    );
    expect(reasons[0]?.tone).toBe("caution");
    expect(reasons[0]?.label).toMatch(/11% win rate/);
    expect(reasons.every((r) => !/DEMO/i.test(r.label))).toBe(true);
    expect(reasons.length).toBeLessThanOrEqual(4);
  });

  it("returns an empty list when the stored row has no usable text", () => {
    expect(
      pickClockReasonsFromJustification(
        stored({ rationale: "   ", sources: [], contradictionFlagged: false }),
      ),
    ).toEqual([]);
  });
});

describe("storedJustificationFromEntry", () => {
  it("returns null when the pick-list row has no justification", () => {
    expect(storedJustificationFromEntry({ teamKey: "frc254", justification: null })).toBeNull();
  });

  it("reads unified pick_list_entries columns", () => {
    const row = storedJustificationFromEntry({
      id: ENTRY_A,
      teamKey: "frc254",
      justification: "Team 254 is ranked #1.",
      justificationSources: [{ kind: "hard_metric", label: "TBA (tba)", detail: "8-1-0" }],
      justificationContradiction: false,
      justificationReason: null,
      justificationGeneratedAt: "2026-03-14T12:00:00.000Z",
    });
    expect(row?.rationale).toBe("Team 254 is ranked #1.");
    expect(pickClockReasonsFromJustification(row!).some((r) => /8-1-0/.test(r.label))).toBe(true);
  });
});

describe("applyStoredJustificationToRecommendation", () => {
  it("prepends stored justifier reasons and leaves teams without a row unchanged", () => {
    const rec = {
      teamKey: "frc254",
      headline: "#1 on Alliance",
      reasons: [{ label: "EPA 45.2", tone: "neutral" as const }],
    };
    const applied = applyStoredJustificationToRecommendation(rec, stored());
    expect(applied.reasons[0]?.label).toMatch(/Team 254 is ranked #1/);
    expect(applied.reasons.some((r) => r.label === "Rating 45.2")).toBe(true);
    expect(applied.reasons.length).toBeLessThanOrEqual(4);

    const other = applyStoredJustificationToRecommendation(
      { teamKey: "frc118", headline: "Team 118", reasons: [{ label: "Event rank #12", tone: "neutral" }] },
      stored(),
    );
    expect(other.reasons).toEqual([{ label: "Event rank #12", tone: "neutral" }]);
  });

  it("does not invent reasons when the stored map is empty", () => {
    const rec = {
      teamKey: "frc254",
      headline: "Team 254",
      reasons: [{ label: "Event rank #3", tone: "strong" as const }],
    };
    expect(applyStoredJustificationToRecommendation(rec, new Map())).toEqual(rec);
  });
});

describe("applyStoredJustificationsToPickClockResult", () => {
  it("overlays stored reasons on the recommendation and alternates", () => {
    const byTeam = new Map([["frc254", stored()], ["frc118", stored({ teamKey: "frc118", rationale: "Team 118 is ranked #2." })]]);
    const result = applyStoredJustificationsToPickClockResult(
      {
        recommendation: {
          teamKey: "frc254",
          headline: "#1 on Alliance",
          reasons: [{ label: "Ranked #1 on Alliance", tone: "strong" as const }],
        },
        alternates: [
          { teamKey: "frc118", headline: "#2 on Alliance", reasons: [{ label: "EPA 12.1", tone: "neutral" as const }] },
        ],
      },
      byTeam,
    );
    expect(result.recommendation?.reasons[0]?.label).toMatch(/Team 254/);
    expect(result.alternates[0]?.reasons[0]?.label).toMatch(/Team 118 is ranked #2/);
  });
});

describe("mergePickClockReasons", () => {
  it("dedupes identical labels and caps at four glance lines", () => {
    const merged = mergePickClockReasons(
      [
        { label: "Team 254 is ranked #1.", tone: "strong" },
        { label: "TBA (tba): EPA 45.2", tone: "neutral" },
      ],
      [
        { label: "team 254 is ranked #1.", tone: "strong" },
        { label: "EPA 45.2", tone: "neutral" },
        { label: "High reliability 90", tone: "strong" },
        { label: "Event rank #3", tone: "strong" },
        { label: "Endgame EPA 12", tone: "neutral" },
      ],
    );
    expect(merged).toHaveLength(4);
    expect(merged.filter((r) => /ranked #1/i.test(r.label))).toHaveLength(1);
  });
});

describe("loadStoredJustificationsForPickClock", () => {
  it("returns an empty index when the org has no pick list", async () => {
    const client = mockClient(() => ({ rows: [], rowCount: 0 }));
    const index = await loadStoredJustificationsForPickClock(client, { orgId: ORG, eventKey: "2026casj" });
    expect(index.byTeamKey.size).toBe(0);
    expect(index.byEntryId.size).toBe(0);
  });

  it("indexes unified and sidecar-fallback rows by team and entry", async () => {
    const client = mockClient((sql) => {
      if (sql.includes("FROM pick_lists")) {
        return { rows: [{ id: PICK_LIST }], rowCount: 1 };
      }
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
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const index = await loadStoredJustificationsForPickClock(client, {
      orgId: ORG,
      eventKey: "2026casj",
    });
    expect(index.byTeamKey.get("frc254")?.rationale).toMatch(/Team 254/);
    expect(index.byEntryId.get(ENTRY_A)?.teamKey).toBe("frc254");
    expect(pickClockReasonsFromJustification(index.byTeamKey.get("frc254")!)[0]?.label).toMatch(/ranked #1/);
  });

  it("skips a provided pickListId resolve query and omits blank rationales", async () => {
    const queries: string[] = [];
    const client = mockClient((sql) => {
      queries.push(sql);
      if (sql.includes("LEFT JOIN picklist_justifier_justifications j")) {
        return {
          rows: [
            {
              pickListEntryId: ENTRY_A,
              teamKey: "frc254",
              rationale: "   ",
              sources: [],
              contradictionFlagged: false,
              contradictionReason: null,
              createdAt: null,
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const index = await loadStoredJustificationsForPickClock(client, {
      orgId: ORG,
      pickListId: PICK_LIST,
    });
    expect(queries.some((q) => q.includes("FROM pick_lists") && !q.includes("pick_list_entries"))).toBe(false);
    expect(index.byTeamKey.size).toBe(0);
  });
});
