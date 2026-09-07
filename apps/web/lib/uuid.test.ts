import { describe, expect, it } from "vitest";
import { isUuidShape, uuidShapeOrNull } from "./uuid";

describe("uuid shape guard", () => {
  it("accepts a real uuid in either case", () => {
    expect(isUuidShape("b4f30a0d-d653-4c8f-b1dc-282e05df58fa")).toBe(true);
    expect(isUuidShape("B4F30A0D-D653-4C8F-B1DC-282E05DF58FA")).toBe(true);
  });

  it("rejects the strings that actually reach a query string", () => {
    // "undefined" is the one that shipped: a client interpolated a missing id
    // and Postgres answered with its own syntax error, which the route echoed.
    for (const value of ["undefined", "null", "", "  ", "1", "not-a-uuid"]) {
      expect(isUuidShape(value), value).toBe(false);
    }
  });

  it("rejects a uuid with anything appended, so it cannot smuggle SQL text", () => {
    expect(isUuidShape("b4f30a0d-d653-4c8f-b1dc-282e05df58fa'")).toBe(false);
    expect(isUuidShape("b4f30a0d-d653-4c8f-b1dc-282e05df58fa extra")).toBe(false);
  });

  it("rejects non-strings rather than coercing them", () => {
    for (const value of [undefined, null, 12, {}, []]) {
      expect(isUuidShape(value)).toBe(false);
    }
  });

  it("collapses absent and malformed to null for optional filters", () => {
    expect(uuidShapeOrNull("undefined")).toBeNull();
    expect(uuidShapeOrNull(null)).toBeNull();
    expect(uuidShapeOrNull("b4f30a0d-d653-4c8f-b1dc-282e05df58fa")).toBe(
      "b4f30a0d-d653-4c8f-b1dc-282e05df58fa",
    );
  });
});
