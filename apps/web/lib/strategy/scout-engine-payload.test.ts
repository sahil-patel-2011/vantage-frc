import { describe, expect, it } from "vitest";
import { buildFormEngineMap } from "../scouting/form-engine-map";
import {
  engineBindingsFromRoles,
  projectScoutEnginePayload,
  projectScoutEntriesForEngine,
  resolveScoutEngineScores,
} from "./scout-engine-payload";

const CUSTOM_UNMAPPED = {
  fields: [
    { key: "cargo_high", type: "counter" as const },
    { key: "cargo_low", type: "counter" as const },
    { key: "hangar", type: "select" as const },
  ],
};

const CUSTOM_MAPPED = {
  fields: [
    { key: "cargo_auto", type: "counter" as const, config: { role: "auto_score" } },
    { key: "cargo_high", type: "counter" as const, config: { role: "teleop_score" } },
    { key: "hangar", type: "select" as const, config: { role: "endgame" } },
  ],
};

const NULL_SCORES = { autoScore: null, teleop: null, endgame: null };

describe("engineBindingsFromRoles", () => {
  it("binds only scoring roles — defense / fouls / notes / none stay unbound", () => {
    expect(
      engineBindingsFromRoles({
        cargo_auto: "auto_score",
        cargo_high: "teleop_score",
        hangar: "endgame",
        defense: "defense",
        fouls: "fouls",
        notes: "notes",
        leftover: "none",
      }),
    ).toEqual({
      cargo_auto: "autoScore",
      cargo_high: "teleop",
      hangar: "endgame",
    });
  });

  it("accepts raw engine-key bindings and ignores empty maps", () => {
    expect(engineBindingsFromRoles({ speaker: "teleop" })).toEqual({ speaker: "teleop" });
    expect(engineBindingsFromRoles({})).toEqual({});
    expect(engineBindingsFromRoles(null)).toEqual({});
  });
});

describe("resolveScoutEngineScores", () => {
  it("projects mapped custom keys onto autoScore / teleop / endgame", () => {
    const map = buildFormEngineMap(CUSTOM_MAPPED);
    expect(
      resolveScoutEngineScores({ cargo_auto: 6, cargo_high: 18, hangar: 12 }, map),
    ).toEqual({ autoScore: 6, teleop: 18, endgame: 12 });
  });

  it("keeps unmapped keys null — never invents pEPA components", () => {
    const map = buildFormEngineMap(CUSTOM_UNMAPPED);
    expect(
      resolveScoutEngineScores(
        { cargo_high: 20, cargo_low: 8, hangar: 15, autoScore: 99, teleop: 88, endgame: 77 },
        map,
      ),
    ).toEqual(NULL_SCORES);
    expect(resolveScoutEngineScores({ cargo_high: 20 }, {})).toEqual(NULL_SCORES);
    expect(resolveScoutEngineScores({ cargo_high: 20 }, null)).toEqual(NULL_SCORES);
  });

  it("returns null — never 0 — when a mapped field is missing or non-numeric", () => {
    const roles = {
      cargo_auto: "auto_score",
      cargo_high: "teleop_score",
      hangar: "endgame",
    } as const;
    expect(resolveScoutEngineScores({ cargo_high: 9 }, roles)).toEqual({
      autoScore: null,
      teleop: 9,
      endgame: null,
    });
    expect(resolveScoutEngineScores({ cargo_auto: "climb", hangar: { level: 2 } }, roles)).toEqual(
      NULL_SCORES,
    );
  });

  it("does not treat a recorded 0 as missing", () => {
    expect(
      resolveScoutEngineScores(
        { cargo_auto: 0, cargo_high: 0, hangar: 0 },
        { cargo_auto: "auto_score", cargo_high: "teleop_score", hangar: "endgame" },
      ),
    ).toEqual({ autoScore: 0, teleop: 0, endgame: 0 });
  });
});

describe("projectScoutEnginePayload", () => {
  it("writes only engine keys the map resolved to a number", () => {
    const map = buildFormEngineMap(CUSTOM_MAPPED);
    expect(projectScoutEnginePayload({ cargo_high: 18, notes: "fast" }, map)).toEqual({
      cargo_high: 18,
      notes: "fast",
      teleop: 18,
    });
  });

  it("does not add engine keys for an unmapped custom form", () => {
    const map = buildFormEngineMap(CUSTOM_UNMAPPED);
    expect(projectScoutEnginePayload({ cargo_high: 18, notes: "fast" }, map)).toEqual({
      cargo_high: 18,
      notes: "fast",
    });
  });
});

describe("projectScoutEntriesForEngine", () => {
  it("projects each payload before the scout-ops blend", () => {
    const [projected] = projectScoutEntriesForEngine(
      [
        {
          id: "e1",
          teamKey: "frc2337",
          payload: { cargo_auto: 6, cargo_high: 18, hangar: 12, notes: "keep" },
        },
      ],
      {
        cargo_auto: "auto_score",
        cargo_high: "teleop_score",
        hangar: "endgame",
      },
    );
    expect(projected?.payload).toEqual({
      cargo_auto: 6,
      cargo_high: 18,
      hangar: 12,
      notes: "keep",
      autoScore: 6,
      teleop: 18,
      endgame: 12,
    });
  });

  it("leaves unmapped entry payloads without invented engine keys", () => {
    const [projected] = projectScoutEntriesForEngine(
      [{ id: "e1", teamKey: "frc2337", payload: { cargo_high: 20 } }],
      buildFormEngineMap(CUSTOM_UNMAPPED),
    );
    expect(projected?.payload).toEqual({ cargo_high: 20 });
    expect(projected?.payload).not.toHaveProperty("autoScore");
    expect(projected?.payload).not.toHaveProperty("teleop");
    expect(projected?.payload).not.toHaveProperty("endgame");
  });
});
