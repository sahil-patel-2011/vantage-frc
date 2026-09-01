import { describe, expect, it } from "vitest";
import { definitionFromDraft, newDraftQuestion } from "./form-builder";
import {
  buildFormEngineMap,
  engineKeyForField,
  formEngineGaps,
  missingFormEngineKeys,
  projectEnginePayload,
  resolveFormEngineScores,
} from "./form-engine-map";

const CUSTOM_UNMAPPED = {
  title: "Our own form",
  fields: [
    { key: "cargo_high", label: "Cargo high", type: "counter" as const },
    { key: "cargo_low", label: "Cargo low", type: "counter" as const },
    { key: "hangar", label: "Hangar", type: "select" as const },
  ],
};

const CUSTOM_MAPPED = {
  title: "Our own form",
  fields: [
    { key: "cargo_auto", label: "Cargo auto", type: "counter" as const, config: { role: "auto_score" } },
    { key: "cargo_high", label: "Cargo high", type: "counter" as const, config: { role: "teleop_score" } },
    { key: "hangar", label: "Hangar", type: "select" as const, config: { role: "endgame" } },
  ],
};

describe("buildFormEngineMap", () => {
  it("leaves custom keys unbound so pEPA stays null instead of invented", () => {
    const map = buildFormEngineMap(CUSTOM_UNMAPPED);
    expect(map.bindings).toEqual({});
    expect(map.unmapped).toEqual(["cargo_high", "cargo_low", "hangar"]);
    expect(missingFormEngineKeys(map)).toEqual(["autoScore", "teleop", "endgame"]);
    expect(formEngineGaps(map).every((gap) => gap.missing)).toBe(true);
  });

  it("binds published roles to autoScore / teleop / endgame", () => {
    const map = buildFormEngineMap(CUSTOM_MAPPED);
    expect(map.bindings).toEqual({
      cargo_auto: "autoScore",
      cargo_high: "teleop",
      hangar: "endgame",
    });
    expect(map.byEngine).toEqual({
      autoScore: ["cargo_auto"],
      teleop: ["cargo_high"],
      endgame: ["hangar"],
    });
    expect(map.unmapped).toEqual([]);
    expect(missingFormEngineKeys(map)).toEqual([]);
    expect(map.fields.map((field) => field.source)).toEqual(["role", "role", "role"]);
  });

  it("binds conventional engine-key names without a role", () => {
    const map = buildFormEngineMap({
      fields: [
        { key: "autoScore", type: "number" },
        { key: "teleop_score", type: "number" },
        { key: "endgamePoints", type: "number" },
      ],
    });
    expect(map.bindings).toEqual({
      autoScore: "autoScore",
      teleop_score: "teleop",
      endgamePoints: "endgame",
    });
    expect(map.fields.every((field) => field.source === "convention")).toBe(true);
  });

  it("infers auto_* / teleop_* / climb keys as convention binds", () => {
    const map = buildFormEngineMap({
      fields: [
        { key: "auto_leave", type: "number" },
        { key: "teleop_coral", type: "counter" },
        { key: "climb_level", type: "select" },
      ],
    });
    expect(map.bindings).toEqual({
      auto_leave: "autoScore",
      teleop_coral: "teleop",
      climb_level: "endgame",
    });
  });

  it("does not invent a bind for cycles / notes / defense without a role", () => {
    const map = buildFormEngineMap({
      fields: [
        { key: "cycles", type: "counter" },
        { key: "notes", type: "text" },
        { key: "defense", type: "boolean" },
        { key: "fouls", type: "number" },
      ],
    });
    expect(map.bindings).toEqual({});
    expect(map.unmapped).toEqual(["cycles", "notes", "defense", "fouls"]);
  });

  it("honors an explicit role none opt-out even when the key looks like autoScore", () => {
    expect(
      engineKeyForField({ key: "autoScore", config: { role: "none" } }),
    ).toBeNull();
    const map = buildFormEngineMap({
      fields: [{ key: "autoScore", type: "number", config: { role: "none" } }],
    });
    expect(map.bindings).toEqual({});
    expect(map.unmapped).toEqual(["autoScore"]);
  });

  it("ignores layout-only fields and empty / null definitions", () => {
    expect(buildFormEngineMap(null)).toEqual({
      bindings: {},
      byEngine: { autoScore: [], teleop: [], endgame: [] },
      unmapped: [],
      fields: [],
    });
    expect(buildFormEngineMap({ fields: [] }).unmapped).toEqual([]);
    const map = buildFormEngineMap({
      fields: [
        { key: "auto_header", label: "Auto", type: "section_header" },
        { key: "teleop_block", label: "Teleop", type: "section" },
        { key: "auto_score", type: "number" },
      ],
    });
    expect(map.bindings).toEqual({ auto_score: "autoScore" });
    expect(map.unmapped).toEqual([]);
  });

  it("reads the same roles definitionFromDraft persists", () => {
    const definition = definitionFromDraft("Match", [
      newDraftQuestion({ label: "First 15s output", kind: "number", role: "auto_score" }),
      newDraftQuestion({ label: "Driver output", kind: "number", role: "teleop_score" }),
      newDraftQuestion({ label: "Hang result", kind: "mc", optionsText: "none, full", role: "endgame" }),
      newDraftQuestion({ label: "Robot speed", kind: "number" }),
    ]);
    const map = buildFormEngineMap(definition);
    expect(map.bindings).toEqual({
      first_15s_output: "autoScore",
      driver_output: "teleop",
      hang_result: "endgame",
    });
    expect(map.unmapped).toEqual(["robot_speed"]);
  });
});

describe("resolveFormEngineScores", () => {
  it("projects mapped numbers onto engine keys", () => {
    const map = buildFormEngineMap(CUSTOM_MAPPED);
    expect(
      resolveFormEngineScores({ cargo_auto: 6, cargo_high: 18, hangar: 12 }, map),
    ).toEqual({ autoScore: 6, teleop: 18, endgame: 12 });
  });

  it("returns null — never 0 — when a mapped field is missing or non-numeric", () => {
    const map = buildFormEngineMap(CUSTOM_MAPPED);
    expect(resolveFormEngineScores({ cargo_high: 9 }, map)).toEqual({
      autoScore: null,
      teleop: 9,
      endgame: null,
    });
    expect(resolveFormEngineScores({ cargo_auto: "climb", hangar: { level: 2 } }, map)).toEqual({
      autoScore: null,
      teleop: null,
      endgame: null,
    });
    expect(resolveFormEngineScores({}, map)).toEqual({
      autoScore: null,
      teleop: null,
      endgame: null,
    });
  });

  it("never invents scores from unmapped payload keys", () => {
    const map = buildFormEngineMap(CUSTOM_UNMAPPED);
    expect(
      resolveFormEngineScores(
        { cargo_high: 20, cargo_low: 8, hangar: 15, autoScore: 99, teleop: 88, endgame: 77 },
        map,
      ),
    ).toEqual({ autoScore: null, teleop: null, endgame: null });
  });

  it("does not treat a recorded 0 as missing", () => {
    const map = buildFormEngineMap(CUSTOM_MAPPED);
    expect(resolveFormEngineScores({ cargo_auto: 0, cargo_high: 0, hangar: 0 }, map)).toEqual({
      autoScore: 0,
      teleop: 0,
      endgame: 0,
    });
  });

  it("sums several form keys published onto the same engine key", () => {
    const map = buildFormEngineMap({
      fields: [
        { key: "l3", type: "counter", config: { role: "teleop_score" } },
        { key: "l4", type: "counter", config: { role: "teleop_score" } },
      ],
    });
    expect(resolveFormEngineScores({ l3: 4, l4: 3 }, map)).toEqual({
      autoScore: null,
      teleop: 7,
      endgame: null,
    });
  });

  it("accepts a raw formKey → engineKey record and numeric strings", () => {
    expect(
      resolveFormEngineScores(
        { speaker: "11", unused: 40 },
        { speaker: "teleop" },
      ),
    ).toEqual({ autoScore: null, teleop: 11, endgame: null });
  });

  it("stays null when the map or payload is absent — never invents", () => {
    expect(resolveFormEngineScores({ autoScore: 12 }, null)).toEqual({
      autoScore: null,
      teleop: null,
      endgame: null,
    });
    expect(resolveFormEngineScores(null, { cargo_high: "teleop" })).toEqual({
      autoScore: null,
      teleop: null,
      endgame: null,
    });
  });
});

describe("projectEnginePayload", () => {
  it("writes only engine keys that resolved to a number", () => {
    const map = buildFormEngineMap(CUSTOM_MAPPED);
    expect(projectEnginePayload({ cargo_high: 18, notes: "fast" }, map)).toEqual({
      cargo_high: 18,
      notes: "fast",
      teleop: 18,
    });
    expect(projectEnginePayload({ cargo_high: 18 }, buildFormEngineMap(CUSTOM_UNMAPPED))).toEqual({
      cargo_high: 18,
    });
  });
});
