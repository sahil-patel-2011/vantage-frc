import { describe, expect, it } from "vitest";
import {
  detectDisagreements,
  evaluateFormula,
  importScoutData,
  smallTeamAssignments,
  validatePayload,
  type SchemaDefinition,
} from "../src";

const schema: SchemaDefinition = {
  title: "2026 Match",
  fields: [
    { key: "auto", label: "Auto pieces", type: "number", required: true, disagreementThreshold: 1 },
    { key: "climb", label: "Climb", type: "select", options: ["none", "low", "high"] },
    { key: "disabled", label: "Disabled", type: "boolean" },
  ],
};

describe("version-pinned payload validation", () => {
  it("validates types, options, required values, and unknown fields", () => {
    expect(validatePayload(schema, { auto: 3, climb: "high", disabled: false })).toEqual([]);
    expect(validatePayload(schema, { climb: "sky", extra: 1 })).toEqual([
      "Unknown field: extra",
      "Auto pieces is required",
      "Climb has an invalid option",
    ]);
  });
});

describe("cross-scout disagreements", () => {
  it("flags threshold and categorical divergence while excluding low confidence", () => {
    const conflicts = detectDisagreements(schema, [
      { id: "a", confidence: "normal", payload: { auto: 2, climb: "low" } },
      { id: "b", confidence: "high", payload: { auto: 4, climb: "high" } },
      { id: "c", confidence: "low", payload: { auto: 50, climb: "low" } },
    ]);
    expect(conflicts.map((conflict) => conflict.fieldKey)).toEqual(["auto", "climb"]);
    expect(conflicts[0]?.entryIds).toEqual(["a", "b"]);
  });
});

describe("coach value formulas", () => {
  it("evaluates a safe expression tree without dynamic code", () => {
    expect(
      evaluateFormula(
        {
          op: "add",
          args: [
            { op: "multiply", args: [{ op: "field", field: "auto" }, { op: "constant", value: 2 }] },
            { op: "field", field: "teleop" },
          ],
        },
        { auto: 3, teleop: 5 },
      ),
    ).toBe(11);
  });
});

describe("interoperable scouting fallback", () => {
  it("imports ScoutingPASS-style CSV with explicit provenance", () => {
    const [record] = importScoutData({
      content: "event,match,team,auto,notes\n2026test,qm1,254,3,\"clean, fast\"\n",
      format: "csv",
      source: "scoutingpass",
      sourceFile: "export.csv",
      now: new Date("2026-07-15T00:00:00Z"),
    });
    expect(record).toMatchObject({
      eventKey: "2026test",
      matchKey: "qm1",
      teamKey: "frc254",
      payload: { auto: "3", notes: "clean, fast" },
      provenance: { format: "csv", source: "scoutingpass", sourceFile: "export.csv" },
    });
  });

  it("round-trips a QR-safe JSON payload", () => {
    const encoded = Buffer.from(
      JSON.stringify({ eventKey: "2026test", teamKey: "frc111", payload: { score: 8 } }),
    ).toString("base64url");
    expect(importScoutData({ content: `vantage://${encoded}`, format: "qr" })[0]?.payload).toEqual({
      score: 8,
    });
  });

  it("rotates limited scouts across every team assignment", () => {
    const assignments = smallTeamAssignments({
      scouts: ["u1", "u2"],
      matches: [{ matchKey: "qm1", teamKeys: ["frc1", "frc2", "frc3"] }],
    });
    expect(assignments.map(({ userId }) => userId)).toEqual(["u1", "u2", "u1"]);
  });
});
