import { describe, expect, it } from "vitest";
import {
  classifyMatchJobPhase,
  layoutMatchJobFields,
  layoutPitJobFields,
  MATCH_JOB_PHASE_COPY,
} from "./match-job-layout";

describe("layoutMatchJobFields", () => {
  it("orders REBUILT fields Auto → Teleop → Endgame → this match → Notes", () => {
    const sections = layoutMatchJobFields([
      { key: "auto_fuel", label: "Auto fuel scored", type: "number" },
      { key: "teleop_fuel", label: "Teleop fuel scored", type: "number" },
      { key: "fuel_passed", label: "Fuel passed", type: "number" },
      { key: "tower_level", label: "Tower climb", type: "select" },
      { key: "trench", label: "Trench capable this match", type: "boolean" },
      { key: "bump", label: "Bump traversal this match", type: "boolean" },
      { key: "disabled", label: "Disabled", type: "boolean" },
      { key: "notes", label: "Notes", type: "text" },
    ]);
    expect(sections.map((section) => section.phase)).toEqual([
      "auto",
      "teleop",
      "endgame",
      "other",
      "notes",
    ]);
    expect(sections[0]?.fields.map((field) => field.key)).toEqual(["auto_fuel"]);
    expect(sections[1]?.fields.map((field) => field.key)).toEqual(["teleop_fuel"]);
    expect(sections[2]?.fields.map((field) => field.key)).toEqual(["tower_level"]);
    expect(sections[3]?.fields.map((field) => field.key)).toEqual([
      "fuel_passed",
      "trench",
      "bump",
      "disabled",
    ]);
    expect(sections[4]?.fields.map((field) => field.key)).toEqual(["notes"]);
    expect(sections[0]?.purpose).toBe(MATCH_JOB_PHASE_COPY.auto.purpose);
    expect(sections[4]?.purpose).toBe(MATCH_JOB_PHASE_COPY.notes.purpose);
  });

  it("keeps author section titles and skips the injected match-phase control", () => {
    const sections = layoutMatchJobFields([
      { key: "gamePhase", label: "Match phase", type: "select" },
      { key: "auto_header", label: "Autonomous", type: "section_header" },
      { key: "leave", label: "Leave", type: "boolean" },
      { key: "tele_header", label: "Teleop", type: "section_header" },
      { key: "cycles", label: "Cycles", type: "counter" },
    ]);
    expect(sections.map((section) => section.title)).toEqual(["Autonomous", "Teleop"]);
    expect(sections.flatMap((section) => section.fields.map((field) => field.key))).not.toContain(
      "gamePhase",
    );
  });

  it("puts defense with teleop and climb with endgame", () => {
    expect(classifyMatchJobPhase({ key: "defense_time", label: "Defense", type: "timer" })).toBe(
      "teleop",
    );
    expect(classifyMatchJobPhase({ key: "climb_level", label: "Climb", type: "select" })).toBe(
      "endgame",
    );
  });
});

describe("layoutPitJobFields", () => {
  it("puts robot facts first and notes last", () => {
    const sections = layoutPitJobFields([
      { key: "drivetrain_type", label: "Drivetrain", type: "drivetrain_type" },
      { key: "notes", label: "Notes", type: "text" },
      { key: "programming_language", label: "Programming language", type: "select" },
    ]);
    expect(sections.map((section) => section.id)).toEqual(["robot", "notes"]);
    expect(sections[0]?.fields.map((field) => field.key)).toEqual([
      "drivetrain_type",
      "programming_language",
    ]);
    expect(sections[1]?.fields.map((field) => field.key)).toEqual(["notes"]);
  });
});
