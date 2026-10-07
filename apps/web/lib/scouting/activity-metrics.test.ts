import { describe, expect, it } from "vitest";
import { MATCH_CAPTURE_KEY, type MatchCapture } from "@vantage/scouting";
import { buildScoutBreakdown } from "./scout-breakdown";
import { answersToSave } from "./entry-answers";
import { matchScoutingCsv } from "./scout-export";
import { parseCsvRows } from "@vantage/import";

const capture = (count: number | null): MatchCapture => ({ version: 1, seasonYear: 2026, clockStartedAt: 1791288000000, bouts: [{ id: "one", kind: "shooting", startMs: 1000, endMs: 11000, count }] });
describe("activity evidence across collection and analysis", () => {
  it("keeps throughput precision consistent with the original report", () => {
    const original = capture(20);
    original.bouts.push({ id: "zero", kind: "shooting", startMs: 20000, endMs: 21000, count: 0 });
    const result = buildScoutBreakdown([{ matchKey: "2026test_qm1", payload: { [MATCH_CAPTURE_KEY]: original } }]);
    expect(result.fields.find(field => field.key === "recordedActivity.shooting_fuelPerSecond")).toMatchObject({ mean: 1.82 });
  });
  it("preserves metadata in the real Save projection while leaving unseen counts blank", () => {
    const field = { key: "auto_fuel", label: "Auto fuel scored", type: "number" as const, required: true, config: { requireObservation: true } };
    const payload = { [MATCH_CAPTURE_KEY]: capture(0), unknown: "ignored" };
    expect(answersToSave([field], payload)).toEqual({ [MATCH_CAPTURE_KEY]: capture(0) });
  });
  it("gives each match equal weight while keeping duplicate evidence and unknowns visible", () => {
    const rows = [
      { matchKey: "2026test_qm1", payload: { [MATCH_CAPTURE_KEY]: capture(20) } },
      { matchKey: "2026test_qm1", payload: { [MATCH_CAPTURE_KEY]: capture(40) } },
      { matchKey: "2026test_qm2", payload: { [MATCH_CAPTURE_KEY]: capture(0) } },
      { matchKey: "2026test_qm3", payload: { [MATCH_CAPTURE_KEY]: capture(null) } },
    ];
    const result = buildScoutBreakdown(rows);
    const rate = result.fields.find(field => field.key === "recordedActivity.shooting_fuelPerSecond");
    expect(rate?.kind).toBe("number");
    if (rate?.kind === "number") {
      expect(rate.mean).toBe(1.5);
      expect(rate.series.map(point => point.value)).toEqual([3, 0]);
      expect(rate.evidence).toMatchObject({ answered: 2, missing: 1, disagreements: 1, unit: "fuel/second" });
    }
    expect(rows[0]?.payload).not.toHaveProperty("recordedActivity");
  });
  it("exports zero, unknown and portable timeline as separate evidence", () => {
    const rows = [0, null].map((count, index) => ({ matchKey: `2026test_qm${index + 1}`, teamKey: "frc254", scoutName: null, confidence: null, savedAt: null, payload: { [MATCH_CAPTURE_KEY]: capture(count) } }));
    const exported = parseCsvRows(matchScoutingCsv({ fields: [], rows }));
    expect(exported[0]?.["Observed shooting fuel/s"]).toBe("0");
    expect(exported[1]?.["Observed shooting fuel/s"]).toBe("");
    expect(exported[1]?.["Observed shooting seconds"]).toBe("10");
    expect(JSON.parse(exported[0]!["Match activity (versioned JSON)"]!)).toEqual(capture(0));
  });
});
