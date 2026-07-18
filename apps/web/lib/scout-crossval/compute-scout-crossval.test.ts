import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { computeFieldChecks, overallStatusFromFields, resolveAllianceColor, summarizeCrossval } from ".";
import { computeScoutCrossvalView } from "./compute-scout-crossval";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";

/** Returns queued rows in call order — mirrors the sequential query order inside
 * computeScoutCrossvalView (resolveOrg, events, entries, [fields]). */
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

describe("computeScoutCrossvalView", () => {
  it("returns setup_required when the caller has no org membership", async () => {
    const client = queueClient([{ rows: [] }]);
    const view = await computeScoutCrossvalView(client, { userId: USER, requestedOrg: null });
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
    const view = await computeScoutCrossvalView(client, { userId: USER, requestedOrg: ORG });
    expect(view.status).toBe("live");
    if (view.status === "live") {
      expect(view.eventKey).toBeNull();
      expect(view.entries).toEqual([]);
      expect(view.summary.totalEntries).toBe(0);
    }
  });

  it("classifies entries as agree/conflict/unverifiable when computed live over cached score breakdowns", async () => {
    const client = queueClient([
      { rows: [{ orgId: ORG, teamNumber: 118 }] }, // resolveOrg
      { rows: [{ eventKey: "2026test" }] }, // events
      {
        rows: [
          {
            entryId: "entry-agree",
            eventKey: "2026test",
            matchKey: "2026test_qm1",
            teamKey: "frc118",
            teamNumber: 118,
            scoutUserId: USER,
            payload: { autoPoints: 10, teleopPoints: 40, endgamePoints: 5, totalPoints: 55 },
            redAlliance: ["frc118", "frc254"],
            blueAlliance: ["frc1678"],
            scoreBreakdown: { red: { autoPoints: 10, teleopPoints: 41, endgamePoints: 5, totalPoints: 56 }, blue: {} },
            runId: null,
            runAllianceColor: null,
            runOverallStatus: null,
            runAgreeCount: null,
            runConflictCount: null,
            runUnverifiableCount: null,
            runComputedAt: null,
          },
          {
            entryId: "entry-conflict",
            eventKey: "2026test",
            matchKey: "2026test_qm1",
            teamKey: "frc254",
            teamNumber: 254,
            scoutUserId: USER,
            payload: { autoPoints: 2, teleopPoints: 10, endgamePoints: 0, totalPoints: 12 },
            redAlliance: ["frc118", "frc254"],
            blueAlliance: ["frc1678"],
            scoreBreakdown: { red: { autoPoints: 10, teleopPoints: 41, endgamePoints: 5, totalPoints: 56 }, blue: {} },
            runId: null,
            runAllianceColor: null,
            runOverallStatus: null,
            runAgreeCount: null,
            runConflictCount: null,
            runUnverifiableCount: null,
            runComputedAt: null,
          },
          {
            entryId: "entry-unverifiable",
            eventKey: "2026test",
            matchKey: "2026test_qm2",
            teamKey: "frc1678",
            teamNumber: 1678,
            scoutUserId: USER,
            payload: { autoPoints: 12 },
            redAlliance: ["frc118"],
            blueAlliance: ["frc1678"],
            scoreBreakdown: null,
            runId: null,
            runAllianceColor: null,
            runOverallStatus: null,
            runAgreeCount: null,
            runConflictCount: null,
            runUnverifiableCount: null,
            runComputedAt: null,
          },
        ],
      }, // entries (no persisted runs -> computed live, no fields query issued)
    ]);
    const view = await computeScoutCrossvalView(client, { userId: USER, requestedOrg: ORG, eventKey: "2026test" });
    expect(view.status).toBe("live");
    if (view.status !== "live") return;
    expect(view.entries).toHaveLength(3);
    const agreeEntry = view.entries.find((e) => e.matchScoutEntryId === "entry-agree");
    const conflictEntry = view.entries.find((e) => e.matchScoutEntryId === "entry-conflict");
    const unverifiableEntry = view.entries.find((e) => e.matchScoutEntryId === "entry-unverifiable");
    expect(agreeEntry?.overallStatus).toBe("agree");
    expect(conflictEntry?.overallStatus).toBe("conflict");
    expect(unverifiableEntry?.overallStatus).toBe("unverifiable");
    expect(view.summary.totalEntries).toBe(3);
    expect(view.summary.conflictEntries).toBe(1);
  });
});

describe("scout-crossval pure helpers", () => {
  it("resolves alliance color from either array or team_keys alliance shapes", () => {
    expect(resolveAllianceColor("frc118", ["frc118", "frc254"], ["frc1678"])).toBe("red");
    expect(resolveAllianceColor("frc1678", { team_keys: ["frc118"] }, { team_keys: ["frc1678"] })).toBe("blue");
    expect(resolveAllianceColor("frc999", ["frc118"], ["frc1678"])).toBeNull();
  });

  it("marks a field unverifiable when either side is missing data", () => {
    const fields = computeFieldChecks({
      payload: { autoPoints: 10 },
      scoreBreakdown: null,
      allianceColor: "red",
    });
    expect(fields.every((f) => f.status === "unverifiable")).toBe(true);
  });

  it("marks a field agree within tolerance and conflict outside it", () => {
    const fields = computeFieldChecks({
      payload: { autoPoints: 10, teleopPoints: 10 },
      scoreBreakdown: { red: { autoPoints: 11, teleopPoints: 40 } },
      allianceColor: "red",
    });
    const auto = fields.find((f) => f.fieldKey === "autoPoints");
    const teleop = fields.find((f) => f.fieldKey === "teleopPoints");
    expect(auto?.status).toBe("agree");
    expect(teleop?.status).toBe("conflict");
  });

  it("rolls per-field checks up into an overall status", () => {
    const fields = computeFieldChecks({
      payload: { autoPoints: 10, teleopPoints: 10 },
      scoreBreakdown: { red: { autoPoints: 11, teleopPoints: 90 } },
      allianceColor: "red",
    });
    const rollup = overallStatusFromFields(fields);
    expect(rollup.overallStatus).toBe("conflict");
    expect(rollup.conflictCount).toBeGreaterThan(0);
  });

  it("summarizes agreement rate across only verifiable entries", () => {
    const summary = summarizeCrossval([
      {
        id: "1",
        matchScoutEntryId: "1",
        eventKey: "e",
        matchKey: "m",
        teamKey: "frc1",
        teamNumber: 1,
        scoutUserId: "u",
        allianceColor: "red",
        overallStatus: "agree",
        agreeCount: 4,
        conflictCount: 0,
        unverifiableCount: 0,
        fields: [],
        computedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "2",
        matchScoutEntryId: "2",
        eventKey: "e",
        matchKey: "m",
        teamKey: "frc2",
        teamNumber: 2,
        scoutUserId: "u",
        allianceColor: "blue",
        overallStatus: "unverifiable",
        agreeCount: 0,
        conflictCount: 0,
        unverifiableCount: 4,
        fields: [],
        computedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    expect(summary.totalEntries).toBe(2);
    expect(summary.agreementRate).toBe(1);
  });
});
