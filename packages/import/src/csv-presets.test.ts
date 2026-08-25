import { describe, expect, it } from "vitest";
import {
  applyPreset,
  autoDetectColumns,
  presetColumnsFromMapping,
  suggestColumn,
} from "./csv-presets";

describe("suggestColumn", () => {
  it("marks a known header as an exact match", () => {
    expect(suggestColumn("eventKey")).toMatchObject({ target: "event_key", confidence: "exact" });
  });

  it("keeps handling the headers the existing alias table already knew", () => {
    // "Team #" normalizes to "team", which csv-map already matched exactly.
    expect(suggestColumn("Team #")).toMatchObject({ target: "team_key", confidence: "exact" });
    expect(suggestColumn("Match Num")).toMatchObject({ target: "match_key", confidence: "exact" });
  });

  it("fuzzily matches a header the alias table misses", () => {
    expect(suggestColumn("Team Num (scouted)")).toMatchObject({ target: "team_key", confidence: "likely" });
    expect(suggestColumn("Qual Match")).toMatchObject({ target: "match_key", confidence: "likely" });
    expect(suggestColumn("Total Hours Worked")).toMatchObject({ target: "hours", confidence: "likely" });
  });

  it("explains why it proposed a target", () => {
    expect(suggestColumn("Total Hours Worked").reason).toBe('"Total Hours Worked" contains "hours"');
  });

  it("leaves an unrecognized header alone rather than guessing", () => {
    expect(suggestColumn("Notes about the shooter")).toMatchObject({ target: "ignore" });
    expect(suggestColumn("")).toMatchObject({ target: "ignore" });
  });
});

describe("autoDetectColumns", () => {
  it("maps a typical Google Sheets export header row", () => {
    const detected = autoDetectColumns(["Event Code", "Match Num", "Team #", "Scout Name"]);
    expect(detected.map((item) => item.target)).toEqual(["event_key", "match_key", "team_key", "person"]);
  });

  it("refuses to map two headers onto the same target, keeping the stronger one", () => {
    const detected = autoDetectColumns(["Team Num (scouted)", "teamNumber"]);
    // "teamNumber" is an exact alias, so it wins; the fuzzy one is left for the user.
    expect(detected[1]).toMatchObject({ target: "team_key", confidence: "exact" });
    expect(detected[0]).toMatchObject({ target: "ignore" });
    expect(detected[0]!.reason).toMatch(/is a closer match for team_key — pick one/);
  });

  it("keeps the first of two equally-confident matches and flags the second", () => {
    const detected = autoDetectColumns(["Team Num (scouted)", "Robot ID"]);
    expect(detected[0]).toMatchObject({ target: "team_key", confidence: "likely" });
    expect(detected[1]).toMatchObject({ target: "ignore" });
    expect(detected[1]!.reason).toMatch(/already mapped to team_key — pick one/);
  });
});

describe("applyPreset", () => {
  const preset = {
    id: "preset-1",
    name: "Week 1 sheet",
    columns: {
      "Event Code": "event_key" as const,
      "Match Num": "match_key" as const,
      "Team #": "team_key" as const,
    },
  };

  it("reuses the saved mapping verbatim", () => {
    const applied = applyPreset(preset, ["Event Code", "Match Num", "Team #"]);
    expect(applied.columns.map((item) => item.target)).toEqual(["event_key", "match_key", "team_key"]);
    expect(applied.columns.every((item) => item.confidence === "exact")).toBe(true);
    expect(applied.columns[0]!.reason).toBe('saved by the "Week 1 sheet" preset');
    expect(applied.missingHeaders).toEqual([]);
    expect(applied.unknownHeaders).toEqual([]);
  });

  it("reports a sheet that changed shape instead of silently mismapping it", () => {
    const applied = applyPreset(preset, ["Event Code", "Match Num", "Scout Name"]);
    expect(applied.missingHeaders).toEqual(["Team #"]);
    expect(applied.unknownHeaders).toEqual(["Scout Name"]);
  });

  it("falls back to auto-detection for headers the preset does not name", () => {
    const applied = applyPreset(preset, ["Event Code", "Total Hours Worked"]);
    expect(applied.columns[1]).toMatchObject({ target: "hours", confidence: "likely" });
  });
});

describe("presetColumnsFromMapping", () => {
  it("saves only the columns the user actually mapped", () => {
    expect(
      presetColumnsFromMapping({
        "Event Code": "event_key",
        "Scout Name": "ignore",
        "Team #": "team_key",
      }),
    ).toEqual({ "Event Code": "event_key", "Team #": "team_key" });
  });
});
