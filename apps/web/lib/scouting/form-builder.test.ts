import { describe, expect, it } from "vitest";
import {
  definitionFromDraft,
  draftFromDefinition,
  moveQuestion,
  newDraftQuestion,
  parseOptions,
  slugifyKey,
  validateDraft,
} from "./form-builder";

describe("form-builder", () => {
  it("slugifies unique keys", () => {
    const used = new Set<string>();
    expect(slugifyKey("Auto Score", used)).toBe("auto_score");
    expect(slugifyKey("Auto Score", used)).toBe("auto_score_2");
  });

  it("parses option lists", () => {
    expect(parseOptions("none, partial\nfull")).toEqual(["none", "partial", "full"]);
  });

  it("round-trips draft ↔ definition for answer kinds", () => {
    const draft = {
      title: "Match custom",
      questions: [
        newDraftQuestion({ label: "Endgame", kind: "mc", optionsText: "none, park, climb" }),
        newDraftQuestion({ label: "Notes", kind: "free" }),
        newDraftQuestion({ label: "Cycles", kind: "number", required: true }),
        newDraftQuestion({ label: "Disabled", kind: "yesno" }),
        newDraftQuestion({ label: "Drivetrain", kind: "dropdown", optionsText: "swerve, tank" }),
        newDraftQuestion({ label: "Scout tip", kind: "short" }),
        newDraftQuestion({ label: "Drive base", kind: "drivetrain" }),
        newDraftQuestion({ label: "Robot photos", kind: "robot_image" }),
      ],
    };
    const definition = definitionFromDraft(draft.title, draft.questions);
    expect(definition.fields.map((f) => f.type)).toEqual([
      "multiple_choice",
      "long_text",
      "number",
      "boolean",
      "dropdown",
      "short_answer",
      "drivetrain_type",
      "robot_image",
    ]);
    expect(definition.fields[0]?.widget).toBe("mc");
    expect(definition.fields[0]?.options).toEqual(["none", "park", "climb"]);
    expect(definition.fields[6]?.key).toBe("drivetrain_type");
    expect(definition.fields[7]?.key).toBe("robot_images");
    const back = draftFromDefinition(definition);
    expect(back.questions.map((q) => q.kind)).toEqual([
      "mc",
      "free",
      "number",
      "yesno",
      "dropdown",
      "short",
      "drivetrain",
      "robot_image",
    ]);
  });

  it("reorders questions", () => {
    const a = newDraftQuestion({ id: "a", label: "A" });
    const b = newDraftQuestion({ id: "b", label: "B" });
    const c = newDraftQuestion({ id: "c", label: "C" });
    expect(moveQuestion([a, b, c], 0, 2).map((q) => q.id)).toEqual(["b", "c", "a"]);
  });

  it("validates options and blocks scout-name fields", () => {
    const bad = validateDraft("Pit", [
      newDraftQuestion({ label: "Scout name", kind: "short" }),
      newDraftQuestion({ label: "Drive", kind: "mc", optionsText: "only-one" }),
    ]);
    expect(bad.ok).toBe(false);
    expect(bad.errors.some((e) => /identity|scout/i.test(e))).toBe(true);
    expect(bad.errors.some((e) => /two options/i.test(e))).toBe(true);

    const who = validateDraft("Match", [
      newDraftQuestion({ label: "Who scouted?", kind: "short" }),
      newDraftQuestion({ label: "Climb", kind: "dropdown", optionsText: "none, park" }),
    ]);
    expect(who.ok).toBe(false);
    expect(who.errors.some((e) => /identity|userId|scout/i.test(e))).toBe(true);

    const good = validateDraft("Pit", [
      newDraftQuestion({ label: "Drivetrain", kind: "dropdown", optionsText: "swerve, tank" }),
    ]);
    expect(good.ok).toBe(true);
    expect(good.budget.status).toBe("healthy");
  });

  it("strips legacy scout-name fields when loading a published schema into the builder", () => {
    const draft = draftFromDefinition({
      title: "Legacy",
      fields: [
        { key: "auto", label: "Auto", type: "number" },
        { key: "scout_name", label: "Scout name", type: "text" },
      ],
    });
    expect(draft.questions.map((q) => q.label)).toEqual(["Auto"]);
  });
});
