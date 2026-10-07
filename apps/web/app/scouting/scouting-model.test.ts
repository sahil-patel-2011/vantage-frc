import { describe, expect, it } from "vitest";
import { SCOUT_ENTRY_CSV_COLUMNS, myReports, officialFlagsForReport, openAssignment, type MyEntry, type OfficialFlag } from "./scouting-model";
import type { SyncEntry } from "@vantage/scouting";

describe("official checks beside the current report", () => {
  const report = { clientId: "report", orgId: "team", eventKey: "e", type: "match" as const,
    matchKey: "e_qm1", teamKey: "frc254", schemaId: "original-form" };
  const flag: OfficialFlag = { ...report, fieldKey: "score", status: "conflict", scoutValue: 2,
    officialValue: 4, officialSource: "breakdown", detail: "Scores differ." };
  it.each([{ clientId: "other-author-report" }, { orgId: "other-team" }, { eventKey: "other-event" },
    { matchKey: "e_qm2" }, { teamKey: "frc118" }, { schemaId: "new-form" }, { type: "pit" as const }])(
    "does not attach another observation's warning: %j", change => {
      expect(officialFlagsForReport([flag, { ...flag, ...change }], report)).toEqual([flag]);
    },
  );
  it("keeps only the latest acknowledged correction for a field and source", () => {
    const corrected = { ...flag, scoutValue: 4, status: "consistent", detail: "Scores agree." };
    expect(officialFlagsForReport([flag, corrected], report)).toEqual([corrected]);
  });
});

describe("personal reports with queued corrections", () => {
  const saved: MyEntry = { id: "server", clientId: "original", type: "match", matchKey: "e_qm1", teamKey: "frc254",
    schemaId: "older-form", payload: { scored: 2 }, confidence: "normal", updatedAt: "2026-10-07T12:00:00Z" };
  const queued: SyncEntry = { clientId: "original", type: "match", orgId: "team", eventKey: "e", matchKey: "e_qm1", teamKey: "frc254",
    schemaId: "older-form", payload: { scored: 4 }, confidence: "high", source: "manual", updatedAt: "2026-10-07T12:01:00Z" };
  const data = { eventKey: "e", scoutIdentity: { userId: "scout", displayName: "Scout" }, recentEntries: [], myEntries: [saved] };
  it("restores newer device answers and original questions after a reload", () => {
    expect(myReports(data, [queued])).toHaveLength(1);
    expect(myReports(data, [queued])[0]).toMatchObject({ clientId: "original", schemaId: "older-form", payload: { scored: 4 }, confidence: "high" });
  });
  it("keeps a newer server correction and excludes another event", () => {
    expect(myReports(data, [{ ...queued, updatedAt: "2026-10-07T11:00:00Z" }])[0]).toEqual(saved);
    expect(myReports(data, [{ ...queued, eventKey: "different" }])).toEqual([saved]);
  });
  it("recovers pit reports while keeping reports for distinct robots", () => {
    const pit: SyncEntry = { ...queued, type: "pit", matchKey: undefined, clientId: "pit", teamKey: "frc118" };
    expect(myReports(data, [pit]).map(row => [row.type, row.teamKey])).toEqual([["pit", "frc118"], ["match", "frc254"]]);
  });
});

describe("SCOUT_ENTRY_CSV_COLUMNS", () => {
  it("exports identity and confidence with the row", () => {
    expect(SCOUT_ENTRY_CSV_COLUMNS.map((column) => column.header)).toEqual([
      "Match",
      "Team",
      "Type",
      "Scout",
      "Source",
      "Confidence",
      "Answers (JSON)",
      "Observation history (versioned JSON)",
      "Updated at",
    ]);
  });
});

describe("openAssignment", () => {
  const now = Date.parse("2026-09-25T21:00:00Z");
  const data = {
    assignments: [
      { matchKey: "e_qm1", teamKey: "frc6925", compLevel: "qm", matchNumber: 1 },
      { matchKey: "e_qm31", teamKey: "frc118", compLevel: "qm", matchNumber: 31 },
      { matchKey: "e_qm32", teamKey: "frc254", compLevel: "qm", matchNumber: 32 },
    ],
    matches: [
      { matchKey: "e_qm1", matchNumber: 1, matchTime: "2026-09-25T09:42:00Z" },
      { matchKey: "e_qm31", matchNumber: 31, matchTime: "2026-09-25T21:04:00Z" },
      { matchKey: "e_qm32", matchNumber: 32, matchTime: "2026-09-25T21:12:00Z" },
    ],
    recentEntries: [] as Array<{ id: string; type: string; matchKey: string | null; teamKey: string; confidence: string; source: string; updatedAt: string; scoutName: string }>,
  };
  it("skips an assignment that is long over and opens the next one still ahead", () => {
    expect(openAssignment(data, now)?.matchKey).toBe("e_qm31");
  });
  it("skips one already scouted and returns null when nothing is left", () => {
    const scouted = {
      ...data,
      recentEntries: [
        { id: "1", type: "match", matchKey: "e_qm31", teamKey: "frc118", confidence: "high", source: "form", updatedAt: "", scoutName: "S" },
      ],
    };
    expect(openAssignment(scouted, now)?.matchKey).toBe("e_qm32");
    expect(openAssignment(data, Date.parse("2026-09-26T09:00:00Z"))).toBeNull();
  });
});
