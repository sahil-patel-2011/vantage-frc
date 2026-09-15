import { describe, expect, it } from "vitest";
import { lintSchemaBudget } from "@vantage/scouting/trust";
import { matchSchemaForYear, pitSchemaForYear } from "@vantage/scouting";
import { validateDraft } from "../../../lib/scouting/form-builder";
import { defaultQuestions } from "./forms-model";

describe("form-builder starter drafts", () => {
  it("starts a 2026 pit form with observable facts, help, and no claimed scoring", () => {
    const questions = defaultQuestions("pit", 2026);
    expect(questions.map((question) => question.key)).toEqual(
      pitSchemaForYear(2026).fields.map((field) => field.key),
    );
    expect(questions.every((question) => question.helpText.trim().length > 12)).toBe(true);
    expect(questions.every((question) => question.helps.length > 0)).toBe(true);
    expect(questions.every((question) => question.role === "none" || question.role === "notes")).toBe(
      true,
    );
    const validation = validateDraft("Pit scouting", questions, "pit");
    expect(validation.ok).toBe(true);
    expect(validation.pitClaim.status).toBe("ok");
    expect(lintSchemaBudget({ title: "Pit", fields: pitSchemaForYear(2026).fields }).status).toBe(
      "healthy",
    );
  });

  it("starts a 2026 match form that scouts fuel, climb, defense, and driver", () => {
    const questions = defaultQuestions("match", 2026);
    const keys = questions.map((question) => question.key);
    expect(keys).toContain("auto_fuel");
    expect(keys).toContain("teleop_fuel");
    expect(keys).toContain("fuel_passed");
    expect(keys).toContain("tower_level");
    expect(keys).toContain("driver_ability");
    expect(keys).toContain("defense_time");
    expect(questions.find((question) => question.key === "auto_fuel")?.role).toBe("auto_score");
    expect(questions.find((question) => question.key === "teleop_fuel")?.role).toBe("teleop_score");
    expect(questions.find((question) => question.key === "tower_level")?.role).toBe("endgame");
    expect(questions.find((question) => question.key === "notes")?.role).toBe("notes");
    expect(questions.every((question) => question.helpText.trim().length > 12)).toBe(true);
    const validation = validateDraft("Match scouting", questions, "match");
    expect(validation.ok).toBe(true);
    expect(lintSchemaBudget({ title: "Match", fields: matchSchemaForYear(2026).fields }).status).toBe(
      "healthy",
    );
  });
});
