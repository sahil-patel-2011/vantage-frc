import { describe, expect, it } from "vitest";
import type { SchemaDefinition } from "@vantage/scouting";
import { summarizeOriginalQuestionTrust } from "./quality-question-summary";
import { qualityEvidenceSchema, qualityFieldsForSchema } from "./quality-evidence";

const first = "11111111-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";
const definition: SchemaDefinition = { title: "Match", fields: [{ key: "q_saved", label: "Climb", type: "select", config: { officialComparison: "climb" } }] };
const forms = [{ id: first, type: "match" as const, year: 2026, version: 1, definition },
  { id: second, type: "match" as const, year: 2026, version: 2, definition: { ...definition, fields: [{ ...definition.fields[0]!, label: "Auto mobility", config: { officialComparison: "mobility" } }] } }];
describe("quality evidence keeps original form meaning", () => {
  it("separates the same saved key across versions and retains each original label", () => {
    const summaries = summarizeOriginalQuestionTrust([
      { schemaId: first, fieldKey: "q_saved", status: "match" },
      { schemaId: first, fieldKey: "q_saved", status: "match" },
      { schemaId: first, fieldKey: "q_saved", status: "unavailable" },
      { schemaId: first, fieldKey: "q_saved", status: "not_comparable" },
      { schemaId: second, fieldKey: "q_saved", status: "conflict" },
    ], forms);
    expect(summaries).toEqual([
      expect.objectContaining({ schemaId: second, label: "Auto mobility", version: 2, checks: 1, matches: 0, conflicts: 1, confidenceScore: 0 }),
      expect.objectContaining({ schemaId: first, label: "Climb", version: 1, checks: 2, matches: 2, conflicts: 0, confidenceScore: 1 }),
    ]);
    expect(qualityFieldsForSchema({ fieldTrustBySchema: summaries }, first)).toHaveLength(1);
    expect(qualityFieldsForSchema({ fieldTrustBySchema: summaries }, first)[0]?.label).toBe("Climb");
    expect(qualityFieldsForSchema({ fieldTrustBySchema: summaries }, "foreign")).toEqual([]);
  });
  it("cannot manufacture meaning from absent, unknown or pit questions", () => {
    const rows = [{ schemaId: first, fieldKey: "q_saved", status: "match" as const },
      { schemaId: second, fieldKey: "missing", status: "conflict" as const }];
    expect(summarizeOriginalQuestionTrust(rows, [])).toEqual([]);
    expect(summarizeOriginalQuestionTrust(rows, [{ ...forms[0]!, type: "pit" }])).toEqual([]);
    expect(summarizeOriginalQuestionTrust(rows, [{ ...forms[0]!, definition: { ...definition,
      fields: [{ ...definition.fields[0]!, config: { officialComparison: "none" } }] } }])).toEqual([]);
    expect(qualityFieldsForSchema({}, first)).toEqual([]);
    expect(qualityFieldsForSchema({}, null)).toEqual([]);
  });
  it("retains the legacy aggregate contract while validating version-scoped evidence", () => {
    const legacy = { orgId: first, eventKey: "2026txho", fieldTrust: [], leaderboard: [] };
    expect(qualityEvidenceSchema.safeParse(legacy).success).toBe(true);
    const summaries = summarizeOriginalQuestionTrust([{ schemaId: first, fieldKey: "q_saved", status: "match" }], forms);
    expect(qualityEvidenceSchema.parse({ ...legacy, fieldTrustBySchema: summaries }).fieldTrustBySchema).toEqual(summaries);
    expect(qualityEvidenceSchema.safeParse({ ...legacy, fieldTrustBySchema: [{ ...summaries[0], schemaId: "invalid" }] }).success).toBe(false);
  });
});
