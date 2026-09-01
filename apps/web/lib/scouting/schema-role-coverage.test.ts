import { describe, expect, it } from "vitest";
import { auditScoutSchemaRoles, hasBlockingRoleGap } from "./schema-role-coverage";

const DEFAULT_MATCH_SCHEMA = {
  type: "match" as const,
  definition: {
    title: "Match scouting",
    fields: [
      { key: "auto_score", label: "Auto score", type: "number" },
      { key: "teleop_score", label: "Teleop score", type: "number" },
      { key: "endgame", label: "Endgame", type: "select", options: ["none", "park", "climb"] },
      { key: "defense", label: "Played defense", type: "yesno" },
      { key: "fouls", label: "Fouls", type: "counter" },
      { key: "notes", label: "Notes", type: "text" },
    ],
  },
};

const DEFAULT_PIT_SCHEMA = {
  type: "pit" as const,
  definition: {
    title: "Pit scouting",
    fields: [{ key: "pitNotes", label: "Pit notes", type: "text" }],
  },
};

describe("auditScoutSchemaRoles", () => {
  it("reports no_schema (not a warning) when nothing is published yet", () => {
    const coverage = auditScoutSchemaRoles([]);
    expect(coverage.status).toBe("no_schema");
    expect(coverage.warnings).toEqual([]);
    expect(hasBlockingRoleGap(coverage)).toBe(false);
  });

  it("treats a schema with no fields as nothing published", () => {
    expect(auditScoutSchemaRoles([{ type: "match", definition: { title: "x", fields: [] } }]).status).toBe(
      "no_schema",
    );
    expect(auditScoutSchemaRoles([{ type: "match", definition: null }]).status).toBe("no_schema");
  });

  it("passes the DEFAULT schemas with no warnings via key inference alone", () => {
    const coverage = auditScoutSchemaRoles([DEFAULT_MATCH_SCHEMA, DEFAULT_PIT_SCHEMA]);
    expect(coverage.status).toBe("ok");
    expect(coverage.missingRoles).toEqual([]);
    expect(coverage.warnings).toEqual([]);
    expect(coverage.mappedRoles).toEqual([
      "auto_score",
      "defense",
      "endgame",
      "fouls",
      "notes",
      "teleop_score",
    ]);
  });

  it("flags a custom schema whose questions reach no scoring signal as blocking", () => {
    const coverage = auditScoutSchemaRoles([
      {
        type: "match",
        definition: {
          title: "Our own form",
          fields: [
            { key: "cargo_high", label: "Cargo high", type: "counter" },
            { key: "cargo_low", label: "Cargo low", type: "counter" },
            { key: "hangar", label: "Hangar", type: "select", options: ["no", "yes"] },
          ],
        },
      },
    ]);

    expect(coverage.status).toBe("warnings");
    expect(hasBlockingRoleGap(coverage)).toBe(true);
    expect(coverage.missingRoles).toEqual([
      "auto_score",
      "teleop_score",
      "endgame",
      "fouls",
      "defense",
      "notes",
    ]);
    const blocking = coverage.warnings.filter((warning) => warning.severity === "blocking");
    expect(blocking.map((warning) => warning.role)).toEqual([
      "auto_score",
      "teleop_score",
      "endgame",
    ]);
    expect(blocking[0]?.message).toContain("read null");
    expect(coverage.unmappedFields.map((field) => field.key)).toEqual([
      "cargo_high",
      "cargo_low",
      "hangar",
    ]);
  });

  it("clears the blocking warnings once the SAME custom fields declare config.role", () => {
    const coverage = auditScoutSchemaRoles([
      {
        type: "match",
        definition: {
          title: "Our own form",
          fields: [
            { key: "cargo_high", label: "Cargo high", type: "counter", config: { role: "teleop_score" } },
            { key: "cargo_auto", label: "Cargo auto", type: "counter", config: { role: "auto_score" } },
            { key: "hangar", label: "Hangar", type: "select", config: { role: "endgame" } },
          ],
        },
      },
    ]);

    expect(hasBlockingRoleGap(coverage)).toBe(false);
    expect(coverage.roles.cargo_high).toBe("teleop_score");
    // Advisory-only gaps remain, and they are explicitly not blocking.
    expect(coverage.missingRoles).toEqual(["fouls", "defense", "notes"]);
    expect(coverage.warnings.every((warning) => warning.severity === "warning")).toBe(true);
  });

  it("warns when a scoring-looking question is explicitly opted out with role none", () => {
    const coverage = auditScoutSchemaRoles([
      {
        type: "match",
        definition: {
          title: "Match",
          fields: [
            ...DEFAULT_MATCH_SCHEMA.definition.fields,
            {
              key: "teleopPractice",
              label: "Teleop practice only",
              type: "number",
              config: { role: "none" },
            },
          ],
        },
      },
    ]);

    const optedOut = coverage.warnings.find((warning) => warning.id === "opted-out-blocking");
    expect(optedOut?.fields).toEqual(["teleopPractice"]);
    expect(coverage.optedOutFields.map((field) => field.key)).toEqual(["teleopPractice"]);
    // An opt-out is a choice, not a null-feeding bug, so it never escalates to blocking.
    expect(hasBlockingRoleGap(coverage)).toBe(false);
  });

  it("ignores layout-only fields when listing unmapped questions", () => {
    const coverage = auditScoutSchemaRoles([
      {
        type: "match",
        definition: {
          title: "Match",
          fields: [
            { key: "auto_header", label: "Autonomous", type: "section_header" },
            ...DEFAULT_MATCH_SCHEMA.definition.fields,
          ],
        },
      },
    ]);
    expect(coverage.unmappedFields).toEqual([]);
  });

  it("does not demand match-only signals from a pit-only schema", () => {
    const coverage = auditScoutSchemaRoles([DEFAULT_PIT_SCHEMA]);
    expect(coverage.missingRoles).toEqual([]);
    expect(hasBlockingRoleGap(coverage)).toBe(false);
  });
});
