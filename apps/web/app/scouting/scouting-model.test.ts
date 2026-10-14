import { describe, expect, it } from "vitest";
import { SCOUT_ENTRY_CSV_COLUMNS, openAssignment, myReports, type MyEntry } from "./scouting-model";

describe("reports saved before the live list catches up", () => {
  const report = (id: string, type: "match" | "pit", updatedAt: string): MyEntry => ({
    id, clientId: id, type, matchKey: type === "match" ? "e_qm5" : null,
    teamKey: "frc3091", payload: { notes: id }, confidence: "normal", updatedAt,
  });
  it("counts both types immediately without duplicating an acknowledged save", () => {
    const match = report("match", "match", "2026-10-14T10:00:00Z");
    const pit = report("pit", "pit", "2026-10-14T10:01:00Z");
    const merged = myReports({ myEntries: [match], recentEntries: [] }, [match, pit]);
    expect(merged.map(row => row.id)).toEqual(["pit", "match"]);
    expect(merged.filter(row => row.type === "match")).toHaveLength(1);
    expect(merged.filter(row => row.type === "pit")).toHaveLength(1);
  });
  it("prefers a later server edit even when timestamps use different formats", () => {
    const server = report("same", "match", "2026-10-14 11:00:00+00");
    const local = report("same", "match", "2026-10-14T10:00:00Z");
    expect(myReports({ myEntries: [server], recentEntries: [] }, [local])).toEqual([server]);
  });
  it("merges a local save with the legacy recent-report fallback", () => {
    const local = report("local", "pit", "2026-10-14T10:00:00Z");
    expect(myReports({ recentEntries: [] }, [local])).toEqual([local]);
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
