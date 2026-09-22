import { describe, expect, it } from "vitest";
import type { FieldDefinition } from "@vantage/scouting";
import { fieldsForReportTemplate, SCOUTING_REPORT_TEMPLATES } from "./scouting-report-templates";

const fields: FieldDefinition[] = [
  { key: "auto_score", label: "Auto score", type: "number" },
  { key: "teleop_cycles", label: "Teleop cycles", type: "counter" },
  { key: "defense_rating", label: "Defense rating", type: "rating" },
  { key: "endgame", label: "Endgame", type: "select" },
  { key: "notes", label: "Notes", type: "long_text" },
];

describe("scouting report templates", () => {
  it("prioritizes fields matching the selected focus", () => {
    const template = SCOUTING_REPORT_TEMPLATES.find((candidate) => candidate.id === "phase-auto");
    expect(template).toBeDefined();
    expect(fieldsForReportTemplate(fields, template!).map((field) => field.key)).toEqual(["auto_score"]);
  });

  it("returns only metrics that exist in the active form", () => {
    const template = SCOUTING_REPORT_TEMPLATES.find((candidate) => candidate.id === "role-defense");
    expect(template).toBeDefined();
    expect(fieldsForReportTemplate(fields, template!).map((field) => field.key)).toEqual(["defense_rating"]);
  });
});
