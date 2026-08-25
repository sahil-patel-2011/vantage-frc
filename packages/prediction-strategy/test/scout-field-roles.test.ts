import { describe, expect, it } from "vitest";
import {
  buildTeamOperationalSignal,
  computeScoutQuality,
  deriveScoutCapabilities,
  extractNotes,
  fieldRolesFromSchemaDefinitions,
  inferRoleForFieldKey,
  isStrategyFieldRole,
  normalizeSignalKey,
  type ScoutEntryRecord,
  type ScoutFieldRoleMap,
} from "../src";

function matchEntry(
  partial: Partial<ScoutEntryRecord> & Pick<ScoutEntryRecord, "id" | "teamKey" | "payload">,
): ScoutEntryRecord {
  return {
    entryType: "match",
    confidence: "normal",
    scoutUserId: partial.scoutUserId ?? "scout-a",
    matchKey: partial.matchKey ?? "2026miket_qm1",
    ...partial,
  };
}

describe("field role resolution ladder", () => {
  it("normalizes keys so autoScore == auto_score == Auto Score slug", () => {
    expect(normalizeSignalKey("autoScore")).toBe(normalizeSignalKey("auto_score"));
    expect(normalizeSignalKey("teleopCycles")).toBe(normalizeSignalKey("teleop_cycles"));
    expect(normalizeSignalKey("noShow")).toBe(normalizeSignalKey("no_show"));
  });

  it("resolves snake_case form-builder payloads without any role map (default schema)", () => {
    // Exactly what the DEFAULT match schema stores: label-derived snake_case keys.
    const profile = deriveScoutCapabilities([
      { payload: { auto_score: 8, teleop_score: 10, endgame: "full" }, weight: 1 },
      { payload: { auto_score: 6, teleop_score: 9, endgame: "none" }, weight: 1 },
    ]);
    expect(profile.autoRate).toBeGreaterThan(0.4);
    expect(profile.teleopRate).toBeGreaterThan(0.4);
    expect(profile.endgameRate).toBeCloseTo(0.5, 5);
  });

  it("prefers explicit roles over key conventions", () => {
    const roles: ScoutFieldRoleMap = {
      robot_points_scored_in_first_15s: "auto_score",
      driver_period_output: "teleop_score",
      hang_result: "endgame",
      played_d: "defense",
    };
    const profile = deriveScoutCapabilities(
      [
        {
          payload: {
            robot_points_scored_in_first_15s: 9,
            driver_period_output: 11,
            hang_result: "climbed",
            played_d: true,
          },
          weight: 1,
        },
      ],
      { roles },
    );
    expect(profile.autoRate).toBeGreaterThan(0.5);
    expect(profile.teleopRate).toBeGreaterThan(0.5);
    expect(profile.endgameRate).toBe(1);
    expect(profile.defenseLikely).toBe(true);
  });

  it("still resolves legacy camelCase payloads unchanged", () => {
    const profile = deriveScoutCapabilities([
      { payload: { autoPoints: 8, teleopCycles: 10, climb: 1 }, weight: 1 },
    ]);
    expect(profile.autoRate).toBeGreaterThan(0.4);
    expect(profile.teleopRate).toBeGreaterThan(0.4);
    expect(profile.endgameRate).toBeGreaterThan(0);
  });

  it("honors an explicit 'none' opt-out even when key conventions would match", () => {
    const roles: ScoutFieldRoleMap = { autoScore: "none" };
    const profile = deriveScoutCapabilities([{ payload: { autoScore: 12 }, weight: 1 }], {
      roles,
    });
    expect(profile.autoRate).toBeNull();
  });

  it("builds role maps from schema definitions with config.role and key inference", () => {
    const roles = fieldRolesFromSchemaDefinitions([
      {
        fields: [
          { key: "first_15_output", config: { role: "auto_score" } },
          { key: "auto_fuel" }, // 2026 default schema — inferred
          { key: "teleop_fuel" },
          { key: "endgame" },
          { key: "notes" },
          { key: "tower_level" }, // no convention, no config → unmapped
          { key: "autoScore", config: { role: "none" } }, // explicit opt-out
        ],
      },
      null,
    ]);
    expect(roles.first_15_output).toBe("auto_score");
    expect(roles.auto_fuel).toBe("auto_score");
    expect(roles.teleop_fuel).toBe("teleop_score");
    expect(roles.endgame).toBe("endgame");
    expect(roles.notes).toBe("notes");
    expect(roles.tower_level).toBeUndefined();
    expect(roles.autoScore).toBe("none");
  });

  it("infers roles only for conventional key shapes", () => {
    expect(inferRoleForFieldKey("auto_coral")).toBe("auto_score");
    expect(inferRoleForFieldKey("teleopScore")).toBe("teleop_score");
    expect(inferRoleForFieldKey("climb_level")).toBe("endgame");
    expect(inferRoleForFieldKey("played_defense")).toBe("defense");
    expect(inferRoleForFieldKey("foul_count")).toBe("fouls");
    expect(inferRoleForFieldKey("match_notes")).toBe("notes");
    expect(inferRoleForFieldKey("drivetrain_type")).toBe("none");
    expect(isStrategyFieldRole("auto_score")).toBe(true);
    expect(isStrategyFieldRole("made_up")).toBe(false);
  });

  it("extracts notes via role, legacy keys, and snake_case naming", () => {
    expect(
      extractNotes(
        { scout_thoughts: "Great intake under defense", notes: "Solid climb" },
        { scout_thoughts: "notes" },
      ),
    ).toEqual(["Great intake under defense", "Solid climb"]);
    expect(extractNotes({ match_notes: "Slow cycles late" })).toEqual(["Slow cycles late"]);
    expect(extractNotes({ pit_notes: "Swerve, new drivers" })).toEqual(["Swerve, new drivers"]);
  });

  it("feeds a full operational signal from snake_case custom-form entries", () => {
    const roles: ScoutFieldRoleMap = {
      first_15_output: "auto_score",
      driver_output: "teleop_score",
      hang_result: "endgame",
      penalty_count: "fouls",
      scout_thoughts: "notes",
    };
    const entries: ScoutEntryRecord[] = [
      matchEntry({
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        teamKey: "frc1",
        payload: {
          first_15_output: 7,
          driver_output: 9,
          hang_result: "full",
          penalty_count: 1,
          no_show: false,
        },
      }),
      matchEntry({
        id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        teamKey: "frc1",
        payload: {
          first_15_output: 6,
          driver_output: 8,
          hang_result: "none",
          penalty_count: 0,
        },
      }),
      matchEntry({
        id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        teamKey: "frc1",
        payload: {
          first_15_output: 8,
          driver_output: 10,
          hang_result: "park",
          penalty_count: 2,
          disabled: true,
        },
      }),
      {
        id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
        teamKey: "frc1",
        entryType: "pit",
        confidence: "high",
        scoutUserId: "pit-scout",
        matchKey: null,
        payload: { scout_thoughts: "Strong auto; plays defense in eliminations" },
      },
    ];
    const built = buildTeamOperationalSignal("frc1", entries, { roles });
    expect(built).not.toBeNull();
    expect(built!.autoCapability).toBeGreaterThan(0);
    expect(built!.teleopCapability).toBeGreaterThan(0);
    expect(built!.endgameCapability).toBeGreaterThan(0);
    expect(built!.foulRate).toBeGreaterThan(0);
    expect(built!.reliability).toBeLessThan(100); // disabled: true counted
    expect(built!.defenseLikely).toBe(true);
    expect(built!.pitNotes[0]).toMatch(/Strong auto/);
    expect(built!.provenance.some((ref) => ref.influence === "auto_capability")).toBe(true);
    expect(built!.provenance.some((ref) => ref.influence === "endgame_capability")).toBe(true);
  });

  it("finds consensus scores across normalized key spellings", () => {
    const quality = computeScoutQuality([
      matchEntry({
        id: "11111111-1111-1111-1111-111111111111",
        teamKey: "frc1",
        scoutUserId: "a",
        payload: { total_points: 40 },
      }),
      matchEntry({
        id: "22222222-2222-2222-2222-222222222222",
        teamKey: "frc1",
        scoutUserId: "b",
        payload: { totalPoints: 42 },
      }),
    ]);
    const meanScores = quality.scouts.map((scout) => scout.meanScore);
    expect(meanScores).toContain(40);
    expect(meanScores).toContain(42);
  });
});
