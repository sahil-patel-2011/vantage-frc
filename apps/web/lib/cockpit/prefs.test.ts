import { describe, expect, it } from "vitest";
import {
  BUGBOT_INSTRUCTION_MAX,
  DEFAULT_COCKPIT_PREFS,
  clipBugbotInstructions,
  cockpitEquals,
  parseCockpitPrefs,
  saveCockpitPrefs,
  shouldPollWhileVisible,
} from "./prefs";
import { loadCockpitPrefs } from "./load-prefs";

const KNOBS = [
  "confirmWrites",
  "pauseLiveWhenHidden",
  "includeScanTests",
  "bugbotInstructions",
  "defaultBugbotMode",
] as const;

describe("DEFAULT_COCKPIT_PREFS", () => {
  it("is exactly the five Tesla knobs — never a settings maze", () => {
    expect(Object.keys(DEFAULT_COCKPIT_PREFS)).toEqual([...KNOBS]);
    expect(DEFAULT_COCKPIT_PREFS).toEqual({
      confirmWrites: true,
      pauseLiveWhenHidden: true,
      includeScanTests: false,
      bugbotInstructions: "",
      defaultBugbotMode: "subscription",
    });
  });
});

describe("parseCockpitPrefs", () => {
  it("returns defaults for empty or hostile input", () => {
    expect(parseCockpitPrefs(null)).toEqual(DEFAULT_COCKPIT_PREFS);
    expect(parseCockpitPrefs(undefined)).toEqual(DEFAULT_COCKPIT_PREFS);
    expect(parseCockpitPrefs("nope")).toEqual(DEFAULT_COCKPIT_PREFS);
    expect(parseCockpitPrefs([])).toEqual(DEFAULT_COCKPIT_PREFS);
  });

  it("fills missing knobs from defaults", () => {
    expect(parseCockpitPrefs({ includeScanTests: true })).toEqual({
      ...DEFAULT_COCKPIT_PREFS,
      includeScanTests: true,
    });
  });

  it("keeps only the five known knobs", () => {
    const parsed = parseCockpitPrefs({
      confirmWrites: false,
      pauseLiveWhenHidden: false,
      includeScanTests: true,
      bugbotInstructions: "  Never touch CAN id 3.  ",
      defaultBugbotMode: "ultra",
      mystery: true,
    });
    expect(parsed).toEqual({
      confirmWrites: false,
      pauseLiveWhenHidden: false,
      includeScanTests: true,
      bugbotInstructions: "Never touch CAN id 3.",
      defaultBugbotMode: "ultra",
    });
    expect(Object.keys(parsed)).toEqual([...KNOBS]);
  });

  it("ignores non-boolean and unknown mode values", () => {
    expect(parseCockpitPrefs({ confirmWrites: "no", defaultBugbotMode: "max" })).toEqual(
      DEFAULT_COCKPIT_PREFS,
    );
    expect(parseCockpitPrefs({ defaultBugbotMode: "subscription" }).defaultBugbotMode).toBe(
      "subscription",
    );
  });

  it("round-trips through JSON exactly as the jsonb column would", () => {
    const prefs = {
      confirmWrites: false,
      pauseLiveWhenHidden: false,
      includeScanTests: true,
      bugbotInstructions: "Phoenix 6 current limit is 40 A.",
      defaultBugbotMode: "ultra" as const,
    };
    expect(parseCockpitPrefs(JSON.parse(JSON.stringify(prefs)))).toEqual(prefs);
  });
});

describe("clipBugbotInstructions", () => {
  it("caps length and drops empty", () => {
    expect(clipBugbotInstructions(null)).toBe("");
    expect(clipBugbotInstructions(12)).toBe("");
    expect(clipBugbotInstructions("   ")).toBe("");
    expect(clipBugbotInstructions("x".repeat(BUGBOT_INSTRUCTION_MAX + 40))).toHaveLength(
      BUGBOT_INSTRUCTION_MAX,
    );
  });
});

describe("cockpitEquals", () => {
  it("is true only when every knob matches", () => {
    expect(cockpitEquals(DEFAULT_COCKPIT_PREFS, { ...DEFAULT_COCKPIT_PREFS })).toBe(true);
    expect(
      cockpitEquals(DEFAULT_COCKPIT_PREFS, { ...DEFAULT_COCKPIT_PREFS, includeScanTests: true }),
    ).toBe(false);
  });
});

describe("shouldPollWhileVisible", () => {
  it("pauses when hidden unless the driver turned that off", () => {
    expect(shouldPollWhileVisible("hidden")).toBe(false);
    expect(shouldPollWhileVisible("hidden", true)).toBe(false);
    expect(shouldPollWhileVisible("hidden", false)).toBe(true);
    expect(shouldPollWhileVisible("visible", true)).toBe(true);
    expect(shouldPollWhileVisible(undefined)).toBe(true);
  });
});

describe("loadCockpitPrefs", () => {
  it("parses a stored row and falls back when the column is missing", async () => {
    const stored = await loadCockpitPrefs(
      {
        query: async () => ({
          rows: [{ cockpitPrefs: { includeScanTests: true, defaultBugbotMode: "ultra" } }],
        }),
      },
      "11111111-1111-1111-1111-111111111111",
    );
    expect(stored).toEqual({
      ...DEFAULT_COCKPIT_PREFS,
      includeScanTests: true,
      defaultBugbotMode: "ultra",
    });

    const empty = await loadCockpitPrefs({ query: async () => ({ rows: [] }) }, "u");
    expect(empty).toEqual(DEFAULT_COCKPIT_PREFS);

    const missingColumn = await loadCockpitPrefs(
      {
        query: async () => {
          throw new Error("column cockpit_prefs does not exist");
        },
      },
      "u",
    );
    expect(missingColumn).toEqual(DEFAULT_COCKPIT_PREFS);
  });
});

describe("saveCockpitPrefs", () => {
  it("writes only the five knobs as jsonb", async () => {
    let sql = "";
    let params: unknown[] = [];
    const saved = await saveCockpitPrefs(
      {
        query: async (nextSql, nextParams) => {
          sql = nextSql;
          params = nextParams ?? [];
          return { rows: [] };
        },
      },
      "11111111-1111-1111-1111-111111111111",
      {
        confirmWrites: false,
        includeScanTests: true,
        bugbotInstructions: "  Keep CAN id 3.  ",
        defaultBugbotMode: "ultra",
        mystery: "drop me",
      },
    );

    expect(saved).toEqual({
      confirmWrites: false,
      pauseLiveWhenHidden: true,
      includeScanTests: true,
      bugbotInstructions: "Keep CAN id 3.",
      defaultBugbotMode: "ultra",
    });
    expect(sql).toContain("cockpit_prefs");
    expect(sql).toContain("ON CONFLICT (user_id)");
    expect(params[0]).toBe("11111111-1111-1111-1111-111111111111");
    expect(JSON.parse(String(params[1]))).toEqual(saved);
    expect(JSON.parse(String(params[1]))).not.toHaveProperty("mystery");
  });
});
