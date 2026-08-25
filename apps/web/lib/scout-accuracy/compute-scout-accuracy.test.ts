import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { aggregateScoutStats, computeEntryAccuracy, resolveAllianceColor, summarizeScoutAccuracy } from ".";
import { computeScoutAccuracyView } from "./compute-scout-accuracy";
import type { ScoutAccuracyEntry } from "./types";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const SCOUT_A = "22222222-2222-4222-8222-222222222222";
const SCOUT_B = "33333333-3333-4333-8333-333333333333";

/** Returns queued rows in call order — mirrors the sequential query order inside
 * computeScoutAccuracyView (resolveOrg, events, [entries, promotions, snapshot]). */
function queueClient(responses: Array<{ rows: unknown[] }>): PoolClient {
  let index = 0;
  return {
    query: vi.fn().mockImplementation(async () => {
      const response = responses[index] ?? { rows: [] };
      index += 1;
      return response;
    }),
  } as unknown as PoolClient;
}

describe("computeScoutAccuracyView", () => {
  it("returns setup_required when the caller has no org membership", async () => {
    const client = queueClient([{ rows: [] }]);
    const view = await computeScoutAccuracyView(client, { userId: USER, requestedOrg: null });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view with an empty roster when the org has no scout entries yet", async () => {
    const client = queueClient([
      { rows: [{ orgId: ORG, teamNumber: 118 }] }, // resolveOrg
      { rows: [] }, // events
    ]);
    const view = await computeScoutAccuracyView(client, { userId: USER, requestedOrg: ORG });
    expect(view.status).toBe("live");
    if (view.status === "live") {
      expect(view.eventKey).toBeNull();
      expect(view.stats).toEqual([]);
      expect(view.summary.totalEntries).toBe(0);
    }
  });

  it("scores scouts against cached official results and ranks the leaderboard", async () => {
    const client = queueClient([
      { rows: [{ orgId: ORG, teamNumber: 118 }] }, // resolveOrg
      { rows: [{ eventKey: "2026test" }] }, // events
      {
        rows: [
          // Scout A: accurate estimate (55 vs official 56)
          {
            entryId: "entry-a1",
            eventKey: "2026test",
            matchKey: "2026test_qm1",
            teamKey: "frc118",
            teamNumber: 118,
            scoutUserId: SCOUT_A,
            scoutName: "Ada",
            payload: { totalPoints: 55 },
            redAlliance: ["frc118", "frc254"],
            blueAlliance: ["frc1678"],
            scoreBreakdown: { red: { totalPoints: 56 }, blue: {} },
          },
          // Scout B: wildly inaccurate estimate (12 vs official 56)
          {
            entryId: "entry-b1",
            eventKey: "2026test",
            matchKey: "2026test_qm1",
            teamKey: "frc254",
            teamNumber: 254,
            scoutUserId: SCOUT_B,
            scoutName: "Grace",
            payload: { totalPoints: 12 },
            redAlliance: ["frc118", "frc254"],
            blueAlliance: ["frc1678"],
            scoreBreakdown: { red: { totalPoints: 56 }, blue: {} },
          },
          // Scout A: unverifiable (no cached score yet)
          {
            entryId: "entry-a2",
            eventKey: "2026test",
            matchKey: "2026test_qm2",
            teamKey: "frc1678",
            teamNumber: 1678,
            scoutUserId: SCOUT_A,
            scoutName: "Ada",
            payload: { totalPoints: 40 },
            redAlliance: ["frc118"],
            blueAlliance: ["frc1678"],
            scoreBreakdown: null,
          },
        ],
      }, // entries
      { rows: [] }, // promotions
      { rows: [] }, // snapshot
    ]);
    const view = await computeScoutAccuracyView(client, { userId: USER, requestedOrg: ORG, eventKey: "2026test" });
    expect(view.status).toBe("live");
    if (view.status !== "live") return;
    expect(view.entries).toHaveLength(3);
    expect(view.stats).toHaveLength(2);
    expect(view.summary.totalEntries).toBe(3);
    expect(view.summary.verifiableEntries).toBe(2);

    const [top, second] = view.stats;
    expect(top.scoutUserId).toBe(SCOUT_A);
    expect(top.rank).toBe(1);
    expect(top.entriesScored).toBe(2);
    expect(top.verifiableEntries).toBe(1);
    expect(top.accuracyScore).toBeGreaterThan(second.accuracyScore);
    expect(second.scoutUserId).toBe(SCOUT_B);
    expect(second.rank).toBe(2);
    expect(top.promoted).toBe(false);
    expect(view.lastSnapshot).toBeNull();
  });
});

describe("scout-accuracy pure helpers", () => {
  it("resolves alliance color from either array or team_keys alliance shapes", () => {
    expect(resolveAllianceColor("frc118", ["frc118", "frc254"], ["frc1678"])).toBe("red");
    expect(resolveAllianceColor("frc1678", { team_keys: ["frc118"] }, { team_keys: ["frc1678"] })).toBe("blue");
    expect(resolveAllianceColor("frc999", ["frc118"], ["frc1678"])).toBeNull();
  });

  it("marks an entry unverifiable when the official score is missing", () => {
    const entry = computeEntryAccuracy({
      matchScoutEntryId: "1",
      eventKey: "e",
      matchKey: "m",
      teamKey: "frc118",
      teamNumber: 118,
      scoutUserId: SCOUT_A,
      scoutName: "Ada",
      payload: { totalPoints: 40 },
      scoreBreakdown: null,
      redAlliance: ["frc118"],
      blueAlliance: [],
    });
    expect(entry.verifiable).toBe(false);
    expect(entry.accurate).toBe(false);
  });

  it("marks an entry accurate within tolerance and inaccurate outside it", () => {
    const close = computeEntryAccuracy({
      matchScoutEntryId: "1",
      eventKey: "e",
      matchKey: "m",
      teamKey: "frc118",
      teamNumber: 118,
      scoutUserId: SCOUT_A,
      scoutName: "Ada",
      payload: { totalPoints: 55 },
      scoreBreakdown: { red: { totalPoints: 56 } },
      redAlliance: ["frc118"],
      blueAlliance: [],
    });
    expect(close.accurate).toBe(true);

    const far = computeEntryAccuracy({
      matchScoutEntryId: "2",
      eventKey: "e",
      matchKey: "m",
      teamKey: "frc118",
      teamNumber: 118,
      scoutUserId: SCOUT_A,
      scoutName: "Ada",
      payload: { totalPoints: 10 },
      scoreBreakdown: { red: { totalPoints: 56 } },
      redAlliance: ["frc118"],
      blueAlliance: [],
    });
    expect(far.accurate).toBe(false);
  });

  it("aggregates entries per scout, ranks by accuracy score, and applies promotion overrides", () => {
    const entries: ScoutAccuracyEntry[] = [
      {
        matchScoutEntryId: "1",
        eventKey: "e",
        matchKey: "m1",
        teamKey: "frc118",
        teamNumber: 118,
        scoutUserId: SCOUT_A,
        scoutName: "Ada",
        allianceColor: "red",
        scoutValue: 55,
        officialValue: 56,
        absErrorPct: Math.abs(55 - 56) / 56,
        accurate: true,
        verifiable: true,
      },
      {
        matchScoutEntryId: "2",
        eventKey: "e",
        matchKey: "m1",
        teamKey: "frc254",
        teamNumber: 254,
        scoutUserId: SCOUT_B,
        scoutName: "Grace",
        allianceColor: "red",
        scoutValue: 12,
        officialValue: 56,
        absErrorPct: Math.abs(12 - 56) / 56,
        accurate: false,
        verifiable: true,
      },
    ];
    const stats = aggregateScoutStats(entries, new Set([SCOUT_B]));
    expect(stats[0].scoutUserId).toBe(SCOUT_A);
    expect(stats[0].rank).toBe(1);
    expect(stats[0].promoted).toBe(false);
    const scoutB = stats.find((s) => s.scoutUserId === SCOUT_B);
    expect(scoutB?.promoted).toBe(true);

    const summary = summarizeScoutAccuracy(entries, stats);
    expect(summary.totalEntries).toBe(2);
    expect(summary.totalScouts).toBe(2);
    expect(summary.verifiableEntries).toBe(2);
  });
});
