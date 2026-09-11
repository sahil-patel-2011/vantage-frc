import { describe, expect, it } from "vitest";
import { validatePayload } from "@vantage/scouting";
import {
  ANSWER_KIND_OPTIONS,
  BIG_TARGET_ANSWER_KINDS,
  addOption,
  classifyFormBuilderShell,
  groupFieldsBySection,
  isStudioAnswerKind,
  needsSettingsEditor,
  nextMatchKey,
  previewFieldForQuestion,
  retypeQuestion,
  RESET_BEHAVIOR_OPTIONS,
  parseCounterSteps,
  parseSubCounters,
  definitionFromDraft,
  detectedRoleForQuestion,
  draftFromDefinition,
  fieldStrategyRole,
  STRATEGY_ROLE_OPTIONS,
  formBuilderNextActions,
  formBuilderPublishBlockedReason,
  formBuilderPublishLabel,
  formBuilderRelatedLinks,
  formBuilderSetupSteps,
  formBuilderShellCopy,
  FORM_BUILDER_RELATED_INCLUDE,
  moveOption,
  moveQuestion,
  needsOptionEditor,
  newDraftQuestion,
  parseOptions,
  removeOption,
  resolveDraftPublishStatus,
  scoutingPostSaveNextSteps,
  serializeOptions,
  slugifyKey,
  updateOptionAt,
  validateDraft,
} from "./form-builder";
import { expectPlainCopy } from "../ui/copy-assertions";

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
    expect(good.pitClaim.status).toBe("ok");

    const claimed = validateDraft(
      "Pit",
      [
        newDraftQuestion({ label: "Fuel capacity (claimed)", kind: "number" }),
        newDraftQuestion({ label: "Drivetrain", kind: "dropdown", optionsText: "swerve, tank" }),
      ],
      "pit",
    );
    expect(claimed.ok).toBe(true);
    expect(claimed.pitClaim.status).toBe("claimed_scoring");
    expect(claimed.pitClaim.flagged.some((field) => /claimed/i.test(field.label))).toBe(true);
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

  it("edits MC/dropdown option rows", () => {
    expect(needsOptionEditor("mc")).toBe(true);
    expect(needsOptionEditor("short")).toBe(false);
    expect(serializeOptions(["none", "park", "climb"])).toBe("none, park, climb");
    expect(addOption(["a"], "b")).toEqual(["a", "b"]);
    expect(updateOptionAt(["a", "b"], 1, "beta")).toEqual(["a", "beta"]);
    expect(removeOption(["a", "b", "c"], 1)).toEqual(["a", "c"]);
    expect(moveOption(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });

  it("reports draft vs published Soft-UI status", () => {
    const questions = [
      newDraftQuestion({ label: "Climb", kind: "dropdown", optionsText: "none, park" }),
    ];
    const unpublished = resolveDraftPublishStatus({
      published: null,
      draftTitle: "Match",
      draftQuestions: questions,
    });
    expect(unpublished.kind).toBe("unpublished");

    const definition = definitionFromDraft("Match", questions);
    const published = resolveDraftPublishStatus({
      published: { version: 3, definition },
      draftTitle: "Match",
      draftQuestions: questions,
    });
    expect(published.kind).toBe("published");
    expect(published.version).toBe(3);

    const dirty = resolveDraftPublishStatus({
      published: { version: 3, definition },
      draftTitle: "Match",
      draftQuestions: [
        ...questions,
        newDraftQuestion({ label: "Notes", kind: "free" }),
      ],
    });
    expect(dirty.kind).toBe("draft_changes");
  });

  it("builds post-save next-step links to strategy and coverage", () => {
    const steps = scoutingPostSaveNextSteps("org-1", {
      eventKey: "2026casj",
      entryType: "match",
    });
    expect(steps.map((s) => s.id)).toEqual(["strategy", "coverage", "lineup"]);
    expect(steps[0]?.href).toContain("tab=strategy");
    expect(steps[0]?.href).toContain("orgId=org-1");
    expect(steps[1]?.href).toContain("/scout-coverage-live");
    expect(steps[1]?.href).toContain("eventKey=2026casj");
    expect(steps.every((s) => !/demo/i.test(s.label + s.detail))).toBe(true);
  });

  it("builds Scouting / Coverage via hubHref / withOrgHref", () => {
    const links = formBuilderRelatedLinks("org-1", {
      include: [...FORM_BUILDER_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["scouting", "coverage"]);
    expect(links[0]?.href).toContain("tab=scouting");
    expect(links[0]?.href).toContain("orgId=org-1");
    expect(links[1]?.href).toContain("/scouting/lineup");
    expect(links[1]?.href).toContain("orgId=org-1");
  });

  it("uses hubHref / withOrgHref and never DEMO entries", () => {
    const links = formBuilderRelatedLinks("org-1");
    const steps = formBuilderSetupSteps("org-1");
    const actions = formBuilderNextActions({ orgId: "org-1", shell: "empty" });
    expect(JSON.stringify(links)).toContain("tab=scouting");
    expect(JSON.stringify(links)).toContain("/scouting/lineup");
    expect(steps.some((s) => s.id === "scouting")).toBe(true);
    expect(steps.some((s) => s.id === "coverage")).toBe(true);
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
    expectPlainCopy(formBuilderShellCopy("empty").description);
  });

  it("classifies empty/setup shells without inventing DEMO fields", () => {
    expect(
      classifyFormBuilderShell({
        orgId: "org-1",
        eventKey: null,
        year: null,
        hasPublishedSchema: false,
      }),
    ).toBe("setup");
    expect(
      classifyFormBuilderShell({
        orgId: "org-1",
        eventKey: "2026casj",
        year: 2026,
        hasPublishedSchema: false,
      }),
    ).toBe("empty");
    expect(
      classifyFormBuilderShell({
        orgId: "org-1",
        eventKey: "2026casj",
        year: 2026,
        hasPublishedSchema: true,
      }),
    ).toBe("ready");
  });

  it("clarifies publish button labels and blocked reasons", () => {
    const questions = [
      newDraftQuestion({ label: "Climb", kind: "dropdown", optionsText: "none, park" }),
    ];
    const unpublished = resolveDraftPublishStatus({
      published: null,
      draftTitle: "Match",
      draftQuestions: questions,
    });
    expect(
      formBuilderPublishLabel({ busy: false, entryType: "match", status: unpublished }),
    ).toBe("Publish match form");
    expect(
      formBuilderPublishLabel({ busy: true, entryType: "pit", status: unpublished }),
    ).toBe("Publishing…");

    const ok = validateDraft("Match", questions);
    expect(
      formBuilderPublishBlockedReason({
        canManageSchemas: true,
        year: 2026,
        eventKey: "2026casj",
        validation: ok,
        acknowledgeBudget: false,
      }),
    ).toBeNull();
    expect(
      formBuilderPublishBlockedReason({
        canManageSchemas: false,
        year: 2026,
        eventKey: "2026casj",
        validation: ok,
        acknowledgeBudget: false,
      }),
    ).toMatch(/owner or admin/i);
    expect(
      formBuilderPublishBlockedReason({
        canManageSchemas: true,
        year: null,
        eventKey: null,
        validation: ok,
        acknowledgeBudget: false,
      }),
    ).toMatch(/active event/i);
  });

  it("refuses invented DEMO fields in empty/setup copy", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = formBuilderShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
    }
    expect(formBuilderShellCopy("empty").badge).toBe("Not published");
    expectPlainCopy(formBuilderShellCopy("empty").description);
    expect(formBuilderShellCopy("setup").badge).toBe("Needs setup");
    expectPlainCopy(formBuilderShellCopy("setup").description);
    expectPlainCopy(formBuilderShellCopy("loading").description);
    expectPlainCopy(formBuilderShellCopy("error").description);
    expectPlainCopy(formBuilderShellCopy("ready").description);
    const actions = formBuilderNextActions({
      orgId: "org-1",
      shell: "empty",
      canManageSchemas: true,
      entryType: "match",
    });
    expect(actions.some((a) => a.id === "scouting")).toBe(true);
    expect(actions.some((a) => a.id === "coverage")).toBe(true);
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
    for (const action of actions) {
      expectPlainCopy(action.detail);
    }
    for (const action of formBuilderNextActions({ orgId: null, shell: "setup" })) {
      expectPlainCopy(action.detail);
    }
    for (const action of formBuilderNextActions({ orgId: "org-1", shell: "error" })) {
      expectPlainCopy(action.detail);
    }
  });
});

describe("form-builder key stability", () => {
  it("keeps published keys identical when a label is renamed (v1 → v2)", () => {
    // v1: publish a custom form.
    const v1 = definitionFromDraft("Match custom", [
      newDraftQuestion({ label: "Auto score", kind: "number" }),
      newDraftQuestion({ label: "Coral cycles", kind: "number" }),
      newDraftQuestion({ label: "Notes", kind: "free" }),
    ]);
    expect(v1.fields.map((f) => f.key)).toEqual(["auto_score", "coral_cycles", "notes"]);

    // Load v1 into the builder, rename every label, publish v2.
    const draft = draftFromDefinition(v1);
    const renamed = draft.questions.map((question) => ({
      ...question,
      label: `${question.label} (renamed)`,
    }));
    const v2 = definitionFromDraft("Match custom v2", renamed);

    // Keys are identity: stored payloads keyed by v1 stay reachable under v2.
    expect(v2.fields.map((f) => f.key)).toEqual(v1.fields.map((f) => f.key));
    expect(v2.fields.map((f) => f.label)).toEqual([
      "Auto score (renamed)",
      "Coral cycles (renamed)",
      "Notes (renamed)",
    ]);
  });

  it("never lets a new question steal an already-published key", () => {
    const v1 = definitionFromDraft("Match", [
      newDraftQuestion({ label: "Auto score", kind: "number" }),
    ]);
    const draft = draftFromDefinition(v1);
    // New question whose label slugs to the same key, inserted BEFORE the stored one.
    const v2 = definitionFromDraft("Match", [
      newDraftQuestion({ label: "Auto score", kind: "number" }),
      ...draft.questions,
    ]);
    // The stored field keeps auto_score; the newcomer gets a deduped key.
    expect(v2.fields[1]?.key).toBe("auto_score");
    expect(v2.fields[0]?.key).toBe("auto_score_2");
  });

  it("keeps drivetrain/robot-image reserved keys stable through rename", () => {
    const v1 = definitionFromDraft("Pit", [
      newDraftQuestion({ label: "Drive base", kind: "drivetrain" }),
      newDraftQuestion({ label: "Robot photos", kind: "robot_image" }),
    ]);
    expect(v1.fields.map((f) => f.key)).toEqual(["drivetrain_type", "robot_images"]);
    const draft = draftFromDefinition(v1);
    const v2 = definitionFromDraft(
      "Pit",
      draft.questions.map((q) => ({ ...q, label: `${q.label} v2` })),
    );
    expect(v2.fields.map((f) => f.key)).toEqual(["drivetrain_type", "robot_images"]);
  });
});

describe("form-builder strategy roles", () => {
  it("persists explicit roles as field config and round-trips them", () => {
    const definition = definitionFromDraft("Match", [
      newDraftQuestion({ label: "First 15s output", kind: "number", role: "auto_score" }),
      newDraftQuestion({ label: "Driver output", kind: "number", role: "teleop_score" }),
      newDraftQuestion({ label: "Hang result", kind: "mc", optionsText: "none, full", role: "endgame" }),
      newDraftQuestion({ label: "Robot speed", kind: "number" }),
    ]);
    expect(definition.fields[0]?.config).toEqual({ role: "auto_score" });
    expect(definition.fields[1]?.config).toEqual({ role: "teleop_score" });
    expect(definition.fields[2]?.config).toEqual({ role: "endgame" });
    // Auto-detect stays unpersisted so key inference keeps working downstream.
    expect(definition.fields[3]?.config).toBeUndefined();

    const back = draftFromDefinition(definition);
    expect(back.questions.map((q) => q.role)).toEqual([
      "auto_score",
      "teleop_score",
      "endgame",
      "none",
    ]);
  });

  it("infers effective roles for legacy schemas without config.role", () => {
    expect(fieldStrategyRole({ key: "auto_score" })).toBe("auto_score");
    expect(fieldStrategyRole({ key: "teleop_fuel" })).toBe("teleop_score");
    expect(fieldStrategyRole({ key: "endgame" })).toBe("endgame");
    expect(fieldStrategyRole({ key: "notes" })).toBe("notes");
    expect(fieldStrategyRole({ key: "tower_level" })).toBe("none");
    expect(fieldStrategyRole({ key: "auto_score", config: { role: "none" } })).toBe("none");
  });

  it("shows detection from the stored key, not the renamed label", () => {
    expect(detectedRoleForQuestion(newDraftQuestion({ label: "Auto score" }))).toBe("auto_score");
    expect(
      detectedRoleForQuestion(newDraftQuestion({ key: "auto_score", label: "Robot speed" })),
    ).toBe("auto_score");
    expect(detectedRoleForQuestion(newDraftQuestion({ label: "Robot speed" }))).toBe("none");
  });

  it("does not flag a phantom draft change when only role annotations are added", () => {
    // Legacy published schema (no config.role) — effective role via inference.
    const published = definitionFromDraft("Match", [
      newDraftQuestion({ label: "Auto score", kind: "number" }),
      newDraftQuestion({ label: "Notes", kind: "free" }),
    ]);
    const draft = draftFromDefinition(published);
    const status = resolveDraftPublishStatus({
      published: { version: 1, definition: published },
      draftTitle: "Match",
      draftQuestions: draft.questions,
    });
    expect(status.kind).toBe("published");
  });

  it("offers all strategy roles in the builder select", () => {
    const roles = STRATEGY_ROLE_OPTIONS.map((option) => option.role);
    expect(roles).toEqual([
      "none",
      "auto_score",
      "teleop_score",
      "endgame",
      "defense",
      "fouls",
      "notes",
    ]);
  });
});

describe("form-builder input studio", () => {
  it("maps every studio kind to its published field type and back", () => {
    const questions = [
      newDraftQuestion({ label: "Cycles", kind: "counter" }),
      newDraftQuestion({ label: "Scoring", kind: "multi_counter" }),
      newDraftQuestion({ label: "Cycle time", kind: "timer" }),
      newDraftQuestion({ label: "Driver skill", kind: "rating" }),
      newDraftQuestion({ label: "Capabilities", kind: "multi_select", optionsText: "climb, defense" }),
      newDraftQuestion({ label: "Aggression", kind: "slider" }),
      newDraftQuestion({ label: "Auto", kind: "section" }),
      newDraftQuestion({ label: "Scoring spots", kind: "field_position" }),
    ];
    const definition = definitionFromDraft("Match studio", questions);
    expect(definition.fields.map((field) => field.type)).toEqual([
      "counter",
      "multi_counter",
      "timer",
      "rating",
      "multi_select",
      "slider",
      "section_header",
      "field_position",
    ]);
    const back = draftFromDefinition(definition);
    expect(back.questions.map((question) => question.kind)).toEqual([
      "counter",
      "multi_counter",
      "timer",
      "rating",
      "multi_select",
      "slider",
      "section",
      "field_position",
    ]);
  });

  it("publishes studio config the server validator can read back", () => {
    const definition = definitionFromDraft("Match studio", [
      newDraftQuestion({
        label: "Cycles",
        kind: "counter",
        settings: { counterStepsText: "1, 5, 10", maxText: "30" },
      }),
      newDraftQuestion({
        label: "Scoring",
        kind: "multi_counter",
        settings: { counterStepsText: "1,5", subCountersText: "High, Low" },
      }),
      newDraftQuestion({ label: "Cycle time", kind: "timer", settings: { timerMode: "lap" } }),
      newDraftQuestion({ label: "Driver skill", kind: "rating", settings: { ratingMax: 4 } }),
      newDraftQuestion({
        label: "Aggression",
        kind: "slider",
        settings: { sliderMin: 0, sliderMax: 6, sliderStep: 2, sliderMinLabel: "Passive" },
      }),
      newDraftQuestion({
        label: "Scoring spots",
        kind: "field_position",
        settings: { gridCols: 5, gridRows: 4 },
      }),
    ]);
    const [counter, multi, timer, rating, slider, position] = definition.fields;
    expect(counter?.config).toEqual({ steps: [1, 5, 10], max: 30 });
    expect(multi?.config).toEqual({
      steps: [1, 5],
      counters: [
        { key: "high", label: "High" },
        { key: "low", label: "Low" },
      ],
    });
    expect(timer?.config).toEqual({ mode: "lap" });
    expect(rating?.config).toEqual({ max: 4 });
    expect(slider?.config).toEqual({ min: 0, max: 6, step: 2, labels: { min: "Passive" } });
    expect(position?.config).toEqual({ gridCols: 5, gridRows: 4 });

    // A payload the entry UI could produce validates cleanly on the server.
    expect(
      validatePayload(definition, {
        cycles: 12,
        scoring: { high: 3, low: 1 },
        cycle_time: [4.5, 5.25],
        driver_skill: 4,
        aggression: 4,
        scoring_spots: [0, 19],
      }),
    ).toEqual([]);
    // ...and one the UI could not produce does not.
    expect(
      validatePayload(definition, { cycles: 31, aggression: 3, scoring_spots: [20] }),
    ).toEqual([
      "Cycles must be at most 30",
      "Aggression must land on a step of 2",
      "Scoring spots has a cell outside the 5×4 grid",
    ]);
  });

  it("round-trips studio settings through publish then reload", () => {
    const questions = [
      newDraftQuestion({
        label: "Cycles",
        kind: "counter",
        settings: { counterStepsText: "1, 3", allowNegative: true, maxText: "12" },
      }),
      newDraftQuestion({
        label: "Scoring spots",
        kind: "field_position",
        settings: { gridCols: 5, gridRows: 4 },
      }),
    ];
    const definition = definitionFromDraft("Match", questions);
    const back = draftFromDefinition(definition);
    expect(back.questions[0]?.settings).toMatchObject({
      counterStepsText: "1, 3",
      allowNegative: true,
      maxText: "12",
    });
    expect(back.questions[1]?.settings).toMatchObject({ gridCols: 5, gridRows: 4 });
    // Reloading and republishing without edits is not a draft change.
    expect(
      resolveDraftPublishStatus({
        published: { version: 3, definition },
        draftTitle: "Match",
        draftQuestions: back.questions,
      }).kind,
    ).toBe("published");
  });

  it("flags a real draft change when only a studio setting moves", () => {
    const published = definitionFromDraft("Match", [
      newDraftQuestion({ label: "Cycles", kind: "counter", settings: { counterStepsText: "1, 5" } }),
    ]);
    const draft = draftFromDefinition(published);
    const edited = draft.questions.map((question) => ({
      ...question,
      settings: { ...question.settings, counterStepsText: "1, 5, 10" },
    }));
    expect(
      resolveDraftPublishStatus({
        published: { version: 1, definition: published },
        draftTitle: "Match",
        draftQuestions: edited,
      }).kind,
    ).toBe("draft_changes");
  });

  it("keeps stored keys stable across a rename for every studio type", () => {
    const v1 = definitionFromDraft("Match", [
      newDraftQuestion({ label: "Coral cycles", kind: "counter" }),
      newDraftQuestion({ label: "Scoring", kind: "multi_counter" }),
      newDraftQuestion({ label: "Cycle time", kind: "timer" }),
      newDraftQuestion({ label: "Driver skill", kind: "rating" }),
      newDraftQuestion({ label: "Capabilities", kind: "multi_select", optionsText: "climb, defense" }),
      newDraftQuestion({ label: "Aggression", kind: "slider" }),
      newDraftQuestion({ label: "Auto", kind: "section" }),
      newDraftQuestion({ label: "Scoring spots", kind: "field_position" }),
    ]);
    const v1Keys = v1.fields.map((field) => field.key);
    expect(v1Keys).toEqual([
      "coral_cycles",
      "scoring",
      "cycle_time",
      "driver_skill",
      "capabilities",
      "aggression",
      "auto",
      "scoring_spots",
    ]);
    const draft = draftFromDefinition(v1);
    const v2 = definitionFromDraft(
      "Match",
      draft.questions.map((question) => ({ ...question, label: `${question.label} 2026` })),
    );
    expect(v2.fields.map((field) => field.key)).toEqual(v1Keys);
  });

  it("never marks a section header required, in the draft or the definition", () => {
    const question = newDraftQuestion({ label: "Auto", kind: "section", required: true });
    expect(question.required).toBe(false);
    const definition = definitionFromDraft("Match", [
      { ...question, required: true },
      newDraftQuestion({ label: "Cycles", kind: "counter" }),
    ]);
    expect(definition.fields[0]?.required).toBeUndefined();
    expect(validateDraft("Match", [{ ...question, required: true }]).errors).toContain(
      "Question 1 is a section header — it cannot be required.",
    );
  });

  it("keeps section headers out of the accuracy budget", () => {
    const withSections = [
      newDraftQuestion({ label: "Auto", kind: "section" }),
      newDraftQuestion({ label: "Cycles", kind: "counter" }),
      newDraftQuestion({ label: "Teleop", kind: "section" }),
      newDraftQuestion({ label: "Teleop cycles", kind: "counter" }),
    ];
    expect(validateDraft("Match", withSections).budget.fieldCount).toBe(2);
  });

  it("groups fields under their section headers", () => {
    const definition = definitionFromDraft("Match", [
      newDraftQuestion({ label: "Auto", kind: "section" }),
      newDraftQuestion({ label: "Auto cycles", kind: "counter" }),
      newDraftQuestion({ label: "Teleop", kind: "section" }),
      newDraftQuestion({ label: "Teleop cycles", kind: "counter" }),
      newDraftQuestion({ label: "Notes", kind: "free" }),
    ]);
    const sections = groupFieldsBySection(definition);
    expect(sections.map((section) => section.header?.label ?? null)).toEqual(["Auto", "Teleop"]);
    expect(sections[1]?.fields.map((field) => field.key)).toEqual(["teleop_cycles", "notes"]);
  });

  it("rejects impossible studio configs before publish", () => {
    const errors = validateDraft("Match", [
      newDraftQuestion({
        label: "Aggression",
        kind: "slider",
        settings: { sliderMin: 5, sliderMax: 5, sliderStep: 1 },
      }),
      newDraftQuestion({ label: "Skill", kind: "rating", settings: { ratingMax: 99 } }),
      newDraftQuestion({
        label: "Spots",
        kind: "field_position",
        settings: { gridCols: 40, gridRows: 3 },
      }),
      newDraftQuestion({ label: "Scoring", kind: "multi_counter", settings: { subCountersText: "" } }),
      newDraftQuestion({ label: "Caps", kind: "multi_select", optionsText: "only_one" }),
    ]).errors;
    expect(errors).toContain("Question 1 slider max must be greater than its min.");
    expect(errors).toContain("Question 2 rating must top out between 2 and 10.");
    expect(errors).toContain("Question 3 field grid must be between 2 and 12 columns and rows.");
    expect(errors).toContain("Question 4 needs at least one named counter.");
    expect(errors).toContain("Question 5 needs at least two options.");
  });

  it("persists reset behavior only when it is not the default", () => {
    const definition = definitionFromDraft("Match", [
      newDraftQuestion({ label: "Station", kind: "short", reset: "preserve" }),
      newDraftQuestion({ label: "Run", kind: "number", reset: "increment" }),
      newDraftQuestion({ label: "Cycles", kind: "counter", reset: "reset" }),
    ]);
    expect(definition.fields[0]?.config).toEqual({ resetBehavior: "preserve" });
    expect(definition.fields[1]?.config).toEqual({ resetBehavior: "increment" });
    expect(definition.fields[2]?.config).toEqual({ steps: [1, 5, 10] });
    expect(draftFromDefinition(definition).questions.map((question) => question.reset)).toEqual([
      "preserve",
      "increment",
      "reset",
    ]);
  });

  it("parses counter steps and sub-counters the way the builder boxes are typed", () => {
    expect(parseCounterSteps("1, 5, 10")).toEqual([1, 5, 10]);
    expect(parseCounterSteps("10 5 1 5")).toEqual([1, 5, 10]);
    expect(parseCounterSteps("")).toEqual([1, 5, 10]);
    expect(parseCounterSteps("nope")).toEqual([1, 5, 10]);
    expect(parseSubCounters("High goal, Low goal")).toEqual([
      { key: "high_goal", label: "High goal" },
      { key: "low_goal", label: "Low goal" },
    ]);
    expect(parseSubCounters("High, High")).toEqual([
      { key: "high", label: "High" },
      { key: "high_2", label: "High" },
    ]);
  });

  it("steps the match key only when there is a number to step", () => {
    expect(nextMatchKey("qm12")).toBe("qm13");
    expect(nextMatchKey("qm09")).toBe("qm10");
    expect(nextMatchKey("7")).toBe("8");
    expect(nextMatchKey("")).toBeNull();
    expect(nextMatchKey("sf1m2")).toBe("sf1m3");
    expect(nextMatchKey("finals")).toBeNull();
  });

  it("offers the demanded studio kinds in the palette with big-target hints", () => {
    const kinds = ANSWER_KIND_OPTIONS.map((option) => option.kind);
    for (const kind of [
      "counter",
      "multi_counter",
      "timer",
      "rating",
      "multi_select",
      "slider",
      "section",
      "field_position",
    ]) {
      expect(kinds).toContain(kind);
    }
    expect(BIG_TARGET_ANSWER_KINDS).toContain("counter");
    expect(needsOptionEditor("multi_select")).toBe(true);
    expect(needsSettingsEditor("counter")).toBe(true);
    expect(needsSettingsEditor("short")).toBe(false);
  });
  it("previews a studio question through the same config the entry form reads", () => {
    const question = newDraftQuestion({
      label: "Cycles",
      kind: "counter",
      settings: { counterStepsText: "1, 3, 12", maxText: "40", allowNegative: false },
    });
    const field = previewFieldForQuestion(question);
    expect(field.type).toBe("counter");
    expect(field.config).toMatchObject({ steps: [1, 3, 12], max: 40 });
    // The preview field must validate exactly like the published one.
    const schema = { title: "t", fields: [field] };
    expect(validatePayload(schema, { [field.key]: 40 })).toEqual([]);
    expect(validatePayload(schema, { [field.key]: 41 })).toHaveLength(1);
  });

  it("previews options-backed and layout-only studio kinds", () => {
    const multi = previewFieldForQuestion(
      newDraftQuestion({ label: "Defense", kind: "multi_select", optionsText: "Box, Pin, Chase" }),
    );
    expect(multi.type).toBe("multi_select");
    expect(multi.options).toEqual(["Box", "Pin", "Chase"]);

    const section = previewFieldForQuestion(
      newDraftQuestion({ label: "Endgame", kind: "section", required: true }),
    );
    expect(section.type).toBe("section_header");
    // A heading can never gate a save, even if the draft said required.
    expect(section.required).toBeUndefined();
  });

  it("retyping a published question re-seeds config but never re-keys it", () => {
    const published = newDraftQuestion({
      id: "q1",
      key: "auto_cycles",
      label: "Auto cycles",
      kind: "number",
    });
    const retyped = retypeQuestion(published, "counter");
    expect(retyped.key).toBe("auto_cycles");
    expect(retyped.label).toBe("Auto cycles");
    expect(retyped.settings.counterStepsText).toBe("1, 5, 10");

    // ...and it survives a publish round trip under the same key.
    const definition = definitionFromDraft("Match", [retyped]);
    expect(definition.fields[0]?.key).toBe("auto_cycles");
    expect(definition.fields[0]?.type).toBe("counter");
  });

  it("carries counter settings across counter <-> multi-counter, and drops unrelated ones", () => {
    const counter = newDraftQuestion({
      label: "Cycles",
      kind: "counter",
      settings: { counterStepsText: "2, 4", maxText: "9", allowNegative: true },
    });
    const asMulti = retypeQuestion(counter, "multi_counter");
    expect(asMulti.settings.counterStepsText).toBe("2, 4");
    expect(asMulti.settings.maxText).toBe("9");
    expect(asMulti.settings.allowNegative).toBe(true);
    expect(asMulti.settings.subCountersText).toBe("High, Mid, Low");

    // A slider shares nothing with a counter — it starts from its own defaults.
    const asSlider = retypeQuestion(counter, "slider");
    expect(asSlider.settings.counterStepsText).toBeUndefined();
    expect(asSlider.settings).toMatchObject({ sliderMin: 0, sliderMax: 10, sliderStep: 1 });
  });

  it("retyping to a section header clears required and after-save behavior", () => {
    const question = newDraftQuestion({
      label: "Match",
      kind: "short",
      required: true,
      reset: "increment",
    });
    const section = retypeQuestion(question, "section");
    expect(section.required).toBe(false);
    expect(section.reset).toBe("reset");
    expect(definitionFromDraft("Match", [section]).fields[0]?.config).toBeUndefined();
  });

  it("retyping to an options kind seeds two options so the draft can publish", () => {
    const retyped = retypeQuestion(newDraftQuestion({ label: "Endgame", kind: "number" }), "multi_select");
    expect(parseOptions(retyped.optionsText).length).toBeGreaterThanOrEqual(2);
  });

  it("retyping to the same kind is a no-op that keeps hand-edited settings", () => {
    const question = newDraftQuestion({
      label: "Cycles",
      kind: "counter",
      settings: { counterStepsText: "7" },
    });
    expect(retypeQuestion(question, "counter")).toBe(question);
  });

  it("knows which kinds the studio renders, and offers all three after-save behaviors", () => {
    for (const kind of ["counter", "multi_counter", "timer", "rating", "multi_select", "slider", "section", "field_position"] as const) {
      expect(isStudioAnswerKind(kind)).toBe(true);
    }
    for (const kind of ["short", "free", "number", "yesno", "dropdown", "mc", "robot_image"] as const) {
      expect(isStudioAnswerKind(kind)).toBe(false);
    }
    expect(RESET_BEHAVIOR_OPTIONS.map((option) => option.behavior)).toEqual([
      "reset",
      "preserve",
      "increment",
    ]);
  });
});
