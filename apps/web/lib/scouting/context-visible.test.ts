import { describe, expect, it } from "vitest";
import {
  applyPhaseRules,
  clauseMatches,
  ensureGamePhaseField,
  hiddenAnswerKeys,
  inferPhaseFromKey,
  stripHiddenAnswers,
  visibleFields,
  visibleWhenMatches,
  withInferredPhaseRules,
} from "./context-visible";

const fields = [
  { key: "gamePhase", label: "Phase" },
  { key: "autoCoral", label: "Auto coral", visibleWhen: { anyOf: [{ fieldKey: "gamePhase", equals: "auto" }, { fieldKey: "gamePhase", isSet: false }] } },
  { key: "teleopCoral", label: "Teleop coral", visibleWhen: { fieldKey: "gamePhase", oneOf: ["teleop", "endgame"] } },
  { key: "climb", label: "Climb", visibleWhen: { fieldKey: "gamePhase", equals: "endgame" } },
  { key: "defenseTime", label: "Defense time", visibleWhen: { fieldKey: "playingDefense", isTrue: true } },
];

describe("context-aware match fields", () => {
  it("shows auto questions until a later phase is chosen — never invents teleop", () => {
    const auto = visibleFields(fields, {}).map((field) => field.key);
    expect(auto).toEqual(["gamePhase", "autoCoral"]);
    const teleop = visibleFields(fields, { gamePhase: "teleop" }).map((field) => field.key);
    expect(teleop).toEqual(["gamePhase", "teleopCoral"]);
    const end = visibleFields(fields, { gamePhase: "endgame" }).map((field) => field.key);
    expect(end).toContain("climb");
    expect(end).not.toContain("autoCoral");
  });

  it("hides defense timing until the scout says they are playing defense", () => {
    expect(visibleFields(fields, { gamePhase: "teleop" }).some((field) => field.key === "defenseTime")).toBe(false);
    expect(visibleFields(fields, { gamePhase: "teleop", playingDefense: true }).some((field) => field.key === "defenseTime")).toBe(true);
  });

  it("strips hidden answers so a leftover teleop tap does not save during auto", () => {
    const payload = { gamePhase: "auto", autoCoral: 2, teleopCoral: 9 };
    expect(hiddenAnswerKeys(fields, payload)).toContain("teleopCoral");
    expect(stripHiddenAnswers(fields, payload)).toEqual({ gamePhase: "auto", autoCoral: 2 });
  });

  it("matches numeric floors and allOf / anyOf groups", () => {
    expect(clauseMatches({ fieldKey: "cycles", gte: 3 }, { cycles: 4 })).toBe(true);
    expect(clauseMatches({ fieldKey: "cycles", gte: 3 }, { cycles: 2 })).toBe(false);
    expect(
      visibleWhenMatches({ allOf: [{ fieldKey: "gamePhase", equals: "teleop" }, { fieldKey: "cycles", gte: 1 }] }, {
        gamePhase: "teleop",
        cycles: 2,
      }),
    ).toBe(true);
    expect(visibleWhenMatches({ anyOf: [{ fieldKey: "a", isTrue: true }, { fieldKey: "b", isTrue: true }] }, { b: true })).toBe(true);
  });

  it("applies default phase rules onto fields by key", () => {
    const next = applyPhaseRules([{ key: "teleop", config: null }, { key: "notes", config: null }]);
    expect(next[0]?.config?.visibleWhen).toEqual({ fieldKey: "gamePhase", oneOf: ["teleop", "endgame"] });
    expect(next[1]?.config?.visibleWhen).toBeUndefined();
  });

  it("infers REBUILT field keys and prepends match phase when missing", () => {
    expect(inferPhaseFromKey("auto_fuel")).toBe("auto");
    expect(inferPhaseFromKey("teleop_fuel")).toBe("teleop");
    expect(inferPhaseFromKey("tower_level")).toBe("endgame");
    expect(inferPhaseFromKey("fuel_passed")).toBeNull();
    const rebuilt = withInferredPhaseRules([
      { key: "auto_fuel" },
      { key: "teleop_fuel" },
      { key: "tower_level" },
      { key: "notes" },
    ]);
    expect(rebuilt[0]?.key).toBe("gamePhase");
    expect(visibleFields(rebuilt, {}).map((field) => field.key)).toEqual(["gamePhase", "auto_fuel", "notes"]);
    expect(visibleFields(rebuilt, { gamePhase: "teleop" }).map((field) => field.key)).toEqual([
      "gamePhase",
      "teleop_fuel",
      "notes",
    ]);
    expect(ensureGamePhaseField([{ key: "gamePhase" }, { key: "notes" }])).toHaveLength(2);
  });
});
