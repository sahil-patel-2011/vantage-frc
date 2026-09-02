import { describe, expect, it } from "vitest";
import { validatePayload } from "@vantage/scouting";
import {
  coerceConditionValue,
  conditionControllerCandidates,
  definitionFromDraft,
  draftFromDefinition,
  formatDraftSaveIndicator,
  newDraftQuestion,
  resolveDraftPublishStatus,
  validateDraft,
} from "./form-builder";
import { visibleFieldsForPayload } from "./conditional";

describe("conditional visibility in the builder", () => {
  const climbed = newDraftQuestion({ id: "q_climbed", label: "Climbed", kind: "yesno" });
  const level = newDraftQuestion({
    id: "q_level",
    label: "Climb level",
    kind: "dropdown",
    optionsText: "L1, L2, L3",
    required: true,
    visibleWhen: { questionId: "q_climbed", op: "truthy" },
  });
  const auto = newDraftQuestion({ id: "q_auto", label: "Auto score", kind: "number" });
  const why = newDraftQuestion({
    id: "q_why",
    label: "Why so high",
    kind: "free",
    visibleWhen: { questionId: "q_auto", op: "gt", value: "20" },
  });

  it("publishes the condition against the controller's stable key with a coerced value", () => {
    const definition = definitionFromDraft("Match", [climbed, level, auto, why]);
    const levelField = definition.fields.find((field) => field.label === "Climb level")!;
    const whyField = definition.fields.find((field) => field.label === "Why so high")!;
    expect(levelField.config?.visibleWhen).toEqual({ fieldKey: "climbed", op: "truthy" });
    expect(whyField.config?.visibleWhen).toEqual({ fieldKey: "auto_score", op: "gt", value: 20 });
    // The live renderer + validator honor it.
    expect(visibleFieldsForPayload(definition, {}).map((field) => field.key)).toEqual(["climbed", "auto_score"]);
    expect(validatePayload(definition, { climbed: false })).toEqual([]);
    expect(validatePayload(definition, { climbed: true })).toEqual(["Climb level is required"]);
  });

  it("round-trips through draftFromDefinition", () => {
    const definition = definitionFromDraft("Match", [climbed, level, auto, why]);
    const draft = draftFromDefinition(definition);
    const levelQ = draft.questions.find((question) => question.label === "Climb level")!;
    const whyQ = draft.questions.find((question) => question.label === "Why so high")!;
    expect(levelQ.visibleWhen).toEqual({ questionId: "climbed", op: "truthy" });
    expect(whyQ.visibleWhen).toEqual({ questionId: "auto_score", op: "gt", value: "20" });
    // Publishing the round-tripped draft is a no-op change (inferred roles may become explicit,
    // which the publish-status fingerprint already treats as equal).
    expect(
      resolveDraftPublishStatus({
        published: { version: 1, definition },
        draftTitle: draft.title,
        draftQuestions: draft.questions,
      }).kind,
    ).toBe("published");
    const republished = definitionFromDraft(draft.title, draft.questions);
    expect(republished.fields.map((field) => field.config?.visibleWhen ?? null)).toEqual(
      definition.fields.map((field) => field.config?.visibleWhen ?? null),
    );
  });

  it("drops a condition whose controller was removed instead of publishing it dangling", () => {
    const definition = definitionFromDraft("Match", [level, auto]);
    expect(definition.fields[0]!.config?.visibleWhen).toBeUndefined();
    const validation = validateDraft("Match", [level, auto]);
    expect(validation.errors.some((line) => line.includes("was removed"))).toBe(true);
  });

  it("rejects self references and loops", () => {
    const a = newDraftQuestion({ id: "a", label: "A", kind: "yesno", visibleWhen: { questionId: "b", op: "truthy" } });
    const b = newDraftQuestion({ id: "b", label: "B", kind: "yesno", visibleWhen: { questionId: "a", op: "truthy" } });
    const self = newDraftQuestion({ id: "c", label: "C", kind: "yesno", visibleWhen: { questionId: "c", op: "truthy" } });
    const validation = validateDraft("Loop", [a, b, self]);
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((line) => line.startsWith("Visibility loop"))).toBe(true);
    expect(validation.errors.some((line) => line.includes("own answer"))).toBe(true);
  });

  it("offers only answerable, other questions as controllers", () => {
    const header = newDraftQuestion({ id: "h", label: "Teleop", kind: "section" });
    const photo = newDraftQuestion({ id: "p", label: "Photos", kind: "robot_image" });
    const candidates = conditionControllerCandidates([header, photo, climbed, level], "q_level");
    expect(candidates.map((question) => question.id)).toEqual(["q_climbed"]);
  });

  it("coerces values to the controller's answer type", () => {
    expect(coerceConditionValue(climbed, "true")).toBe(true);
    expect(coerceConditionValue(climbed, "no")).toBe(false);
    expect(coerceConditionValue(auto, "12")).toBe(12);
    expect(coerceConditionValue(auto, "abc")).toBe("abc");
    expect(coerceConditionValue(level, "L3")).toBe("L3");
  });
});

describe("formatDraftSaveIndicator", () => {
  const savedAt = "2026-03-07T15:00:00.000Z";
  const at = (seconds: number) => Date.parse(savedAt) + seconds * 1000;

  it("reports the autosave state in coach words", () => {
    expect(formatDraftSaveIndicator("saving", null)).toBe("Saving…");
    expect(formatDraftSaveIndicator("dirty", savedAt)).toBe("Unsaved changes");
    expect(formatDraftSaveIndicator("error", savedAt)).toContain("not saved");
    expect(formatDraftSaveIndicator("idle", null)).toBe("");
    expect(formatDraftSaveIndicator("saved", savedAt, at(2))).toBe("Saved · just now");
    expect(formatDraftSaveIndicator("saved", savedAt, at(12))).toBe("Saved · 12s ago");
    expect(formatDraftSaveIndicator("saved", savedAt, at(3 * 60))).toBe("Saved · 3m ago");
    expect(formatDraftSaveIndicator("saved", savedAt, at(2 * 3600))).toBe("Saved · 2h ago");
  });
});
