import { describe, expect, it } from "vitest";
import { validateDraft } from "../../../lib/scouting/form-builder";
import { defaultQuestions } from "./forms-model";

describe("form-builder starter drafts", () => {
  it("starts a pit form with drivetrain, language, experience, and photos — not claimed scoring", () => {
    const questions = defaultQuestions("pit");
    expect(questions.map((question) => question.label)).toEqual([
      "Drivetrain",
      "Programming language",
      "Drivetrain motors",
      "Driver seasons of experience",
      "Coach seasons of experience",
      "Robot images",
      "Notes",
    ]);
    expect(questions.map((question) => question.kind)).toEqual([
      "drivetrain",
      "dropdown",
      "short",
      "number",
      "number",
      "robot_image",
      "free",
    ]);
    expect(questions.every((question) => question.role === "none" || question.role === "notes")).toBe(
      true,
    );
    const validation = validateDraft("Pit scouting", questions, "pit");
    expect(validation.ok).toBe(true);
    expect(validation.pitClaim.status).toBe("ok");
  });

  it("starts a match form mapped to auto, teleop, endgame, and notes", () => {
    const questions = defaultQuestions("match");
    expect(questions.map((question) => question.role)).toEqual([
      "auto_score",
      "teleop_score",
      "endgame",
      "notes",
    ]);
    const validation = validateDraft("Match scouting", questions, "match");
    expect(validation.ok).toBe(true);
  });
});
