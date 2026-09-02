import { describe, expect, it } from "vitest";
import { LEGACY_CYCLE_TIME_KEYS, cycleTimeFieldKeys } from "./scout-field-roles";

describe("cycleTimeFieldKeys", () => {
  it("picks duration-named cycle fields from the published schema and keeps legacy keys last", () => {
    const keys = cycleTimeFieldKeys([
      { key: "avg_cycle_seconds", type: "number", config: null },
      { key: "teleop_cycles", type: "counter", config: null },
      { key: "cycle", type: "timer", config: { mode: "lap" } },
      { key: "auto_fuel", type: "number", config: null },
      { key: "cycle_time", type: "number", config: null },
    ]);
    expect(keys.slice(0, 3)).toEqual(["avg_cycle_seconds", "cycle", "cycle_time"]);
    for (const legacy of LEGACY_CYCLE_TIME_KEYS) expect(keys).toContain(legacy);
    expect(keys.filter((key) => key === "cycle_time")).toHaveLength(1);
    expect(keys).not.toContain("teleop_cycles");
  });

  it("falls back to the legacy convention when no schema is published", () => {
    expect(cycleTimeFieldKeys([])).toEqual([...LEGACY_CYCLE_TIME_KEYS]);
  });
});
