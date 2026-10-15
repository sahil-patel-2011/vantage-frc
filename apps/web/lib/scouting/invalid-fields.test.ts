import { describe, expect, it } from "vitest";
import { fieldForIssue, firstInvalidField, invalidFieldKeys, issueForField } from "./invalid-fields";

const fields = [
  { key: "auto", label: "Auto" },
  { key: "auto_notes", label: "Auto notes" },
  { key: "climb", label: "Climb" },
];

describe("invalid-fields", () => {
  it("ties a problem to the question with the longest matching label, not a shorter prefix", () => {
    expect(fieldForIssue(fields, "Auto notes is required")?.key).toBe("auto_notes");
    expect(fieldForIssue(fields, "Auto must be a number")?.key).toBe("auto");
    expect([...invalidFieldKeys(fields, ["Auto notes is required"])]).toEqual(["auto_notes"]);
  });

  it("needs a space after the label, so 'Climbing' is not 'Climb'", () => {
    expect(fieldForIssue(fields, "Climbing is required")).toBeNull();
  });

  it("finds the first question to fix in form order", () => {
    expect(firstInvalidField(fields, ["Climb is required", "Auto notes is required"])?.key).toBe("auto_notes");
    expect(firstInvalidField(fields, ["Unknown field: x"])).toBeNull();
  });

  it("gives each question only its own problem", () => {
    const issues = ["Auto notes is required", "Auto must be a number"];
    expect(issueForField(fields, fields[0]!, issues)).toBe("Auto must be a number");
    expect(issueForField(fields, fields[1]!, issues)).toBe("Auto notes is required");
  });
});
