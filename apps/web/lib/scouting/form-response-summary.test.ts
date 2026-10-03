import { describe, expect, it } from "vitest";
import { responseOverview, responsesByScout, responseSummary, responsesCsv, type FormResponseRow } from "./form-response-summary";
import { definitionFromDraft, draftFromDefinition, newDraftQuestion } from "./form-builder";
import { latestScoutingYear, parseFreeScoutReport, scoutingGameLabel } from "./free-scout";

const rows: FormResponseRow[] = [0, undefined, 12].map((n, i) => ({ id: String(i), team: "frc6925", label: "Pit", event: null, payload: n === undefined ? {} : { cycles: n }, observedAt: "2026-10-02T12:00:00Z" }));
describe("published forms and observed responses", () => {
  it("round trips help and chart preferences without changing the answer key", () => {
    const schema = definitionFromDraft("Pit", [newDraftQuestion({ label: "Cycles", kind: "number", storedKey: "cycles", chart: "trend", helpText: "Count completed cycles" })]);
    const restored = draftFromDefinition(schema);
    expect(definitionFromDraft(restored.title, restored.questions)).toEqual(schema);
    expect(responseSummary(schema.fields[0]!, rows)).toMatchObject({ n: 2, mean: 6, numeric: [12, 0], chart: "trend" });
  });
  it("saves custom required answers against the published definition and strips identity overrides", () => {
    const definition = { title: "Custom pit", fields: [{ key: "cycles", label: "Cycles", type: "number" as const, required: true }, { key: "robot_images", label: "Photo", type: "robot_image" as const, required: true }] };
    const report = { id: "aa000000-0000-4000-8000-000000000001", schemaId: "aa000000-0000-4000-8000-000000000002", year: 2026, type: "pit", teamNumber: 6925, label: "Pit scouting", observedAt: "2026-10-02T12:00:00Z", payload: { cycles: 0, spoof: 99 } };
    expect(parseFreeScoutReport(report, definition).payload).toEqual({ cycles: 0 });
    expect(() => parseFreeScoutReport({ ...report, payload: {} }, definition)).toThrow();
  });
  it("escapes CSV quotes and neutralizes spreadsheet formulas", () => {
    const csv = responsesCsv([{ key: "notes", label: "Notes", type: "text" }], [{ ...rows[0]!, payload: { notes: '=HYPERLINK("x")' } }]);
    expect(csv).toContain('"\'=HYPERLINK(""x"")"');
  });
  it("counts each scout's work in full and lists what they filed", () => {
    const filed = (id: string, team: string, scoutId: string, observedAt: string): FormResponseRow =>
      ({ id, team, label: "Pit", event: null, payload: {}, observedAt, scoutId, scout: scoutId === "a" ? "Ada" : "Ben", mine: scoutId === "a" });
    const loaded = [filed("1", "frc6925", "a", "2026-10-02T12:00:00Z"), filed("2", "frc254", "a", "2026-10-02T13:00:00Z"), filed("3", "frc254", "b", "2026-10-02T11:00:00Z")];
    // Ben has 40 responses in all; only one of them is on the loaded page.
    const scouts = [{ id: "a", name: "Ada", total: 2, teams: 2, lastAt: "2026-10-02T13:00:00Z" }, { id: "b", name: "Ben", total: 40, teams: 31, lastAt: "2026-10-02T11:00:00Z" }];
    expect(responsesByScout(scouts, loaded).map(scout => [scout.name, scout.count, scout.rows.length])).toEqual([["Ben", 40, 1], ["Ada", 2, 2]]);
    // Filtered to one team, the count is what the filter leaves and an empty scout drops out.
    expect(responsesByScout(scouts, loaded.filter(row => row.team === "frc6925"), true).map(scout => [scout.name, scout.count])).toEqual([["Ada", 1]]);
    expect(responseOverview(loaded)).toEqual({ responses: 3, teams: 2, mine: 2, latest: "2026-10-02T13:00:00Z" });
    expect(responseOverview([])).toEqual({ responses: 0, teams: 0, mine: 0, latest: null });
  });
  it("puts the scout in a lead's export and leaves the column out for everyone else", () => {
    const field = [{ key: "cycles", label: "Cycles", type: "number" as const }];
    expect(responsesCsv(field, [{ ...rows[0]!, scout: "Ada" }]).split("\r\n")[0]).toBe('"Team","Match / report","Event","Recorded","Scout","Cycles"');
    expect(responsesCsv(field, [rows[0]!]).split("\r\n")[0]).toBe('"Team","Match / report","Event","Recorded","Cycles"');
  });
  it("defaults to the last released game through off-season planning", () => {
    expect(latestScoutingYear(new Date("2026-10-02T00:00:00Z"))).toBe(2026);
    expect(scoutingGameLabel(2026)).toBe("REBUILT · 2026");
  });
});
