import { describe, expect, it } from "vitest";
import { responseSummary, responsesCsv, type FormResponseRow } from "./form-response-summary";
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
  it("defaults to the last released game through off-season planning", () => {
    expect(latestScoutingYear(new Date("2026-10-02T00:00:00Z"))).toBe(2026);
    expect(scoutingGameLabel(2026)).toBe("REBUILT · 2026");
  });
});
