import { describe, expect, it } from "vitest";
import { visibleFields } from "@vantage/scouting/visibility";
import type { FieldDefinition } from "@vantage/scouting";
import { scoutAnswerProgress } from "./answer-progress";

describe("scout progress without invented observations", () => {
  const fields: FieldDefinition[] = [
    { key: "heading", label: "Climb", type: "section_header" },
    { key: "attempted", label: "Attempted climb", type: "boolean", required: true },
    { key: "seconds", label: "Seconds", type: "number", required: true, visibleWhen: { fieldKey: "attempted", isTrue: true } },
    { key: "notes", label: "Notes", type: "text" },
  ];
  it("counts explicit no and zero while excluding hidden questions and headings", () => {
    expect(scoutAnswerProgress(visibleFields(fields, { attempted: false }), { attempted: false })).toMatchObject({ total: 2, answered: 1, requiredRemaining: [], optionalRemaining: 1 });
    expect(scoutAnswerProgress(fields, { attempted: true, seconds: 0 })).toMatchObject({ total: 3, answered: 2, requiredRemaining: [] });
  });
  it("points only to reachable missing required answers", () => {
    const answers = { attempted: true };
    expect(scoutAnswerProgress(visibleFields(fields, answers), answers).requiredRemaining.map(field => field.key)).toEqual(["seconds"]);
    expect(scoutAnswerProgress(fields, answers).optionalRemaining).toBe(1);
  });
});
