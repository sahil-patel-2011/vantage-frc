import { describe, expect, it } from "vitest";
import {
  NO_WEIGH_IN_CLOSE_CUE,
  closePlannedAgainstWeighIn,
  isCloseBlank,
  latestScaleEntry,
  scaleEntriesFromWeighInPayload,
} from "./close-vs-weigh-in";

describe("closePlannedAgainstWeighIn", () => {
  it("compares planned component lb against the latest logged scale reading", () => {
    const close = closePlannedAgainstWeighIn(110.25, [
      { weightLbs: 118, weighedOn: "2026-02-20" },
      { weightLbs: 104, weighedOn: "2026-01-10" },
    ]);
    expect(close.plannedLbs).toBe(110.25);
    expect(close.loggedLbs).toBe(118);
    expect(close.loggedOn).toBe("2026-02-20");
    expect(close.deltaLbs).toBe(7.75);
    expect(isCloseBlank(close)).toBe(false);
  });

  it("stays blank on the scale side when there are no weigh-in entries", () => {
    const close = closePlannedAgainstWeighIn(95, []);
    expect(close.plannedLbs).toBe(95);
    expect(close.loggedLbs).toBeNull();
    expect(close.loggedOn).toBeNull();
    expect(close.deltaLbs).toBeNull();
    expect(isCloseBlank(close)).toBe(true);
    expect(NO_WEIGH_IN_CLOSE_CUE).toMatch(/blank/);
  });

  it("does not invent a default scale reading (no 115 / 125 / 0 stand-in)", () => {
    const close = closePlannedAgainstWeighIn(80, []);
    expect(close.loggedLbs).toBeNull();
    expect(close.loggedLbs).not.toBe(0);
    expect(close.loggedLbs).not.toBe(115);
    expect(close.loggedLbs).not.toBe(125);
  });

  it("treats unusable rows as no entries rather than a third weight", () => {
    const close = closePlannedAgainstWeighIn(70, [
      { weightLbs: Number.NaN, weighedOn: "2026-02-01" },
      { weightLbs: -4, weighedOn: "2026-02-02" },
      { weightLbs: 90, weighedOn: "" },
    ]);
    expect(isCloseBlank(close)).toBe(true);
    expect(close.loggedLbs).toBeNull();
  });
});

describe("latestScaleEntry", () => {
  it("picks the newest weighedOn — one scale, not an average", () => {
    const latest = latestScaleEntry([
      { weightLbs: 100, weighedOn: "2026-01-01" },
      { weightLbs: 112.4, weighedOn: "2026-03-01" },
      { weightLbs: 108, weighedOn: "2026-02-15" },
    ]);
    expect(latest).toEqual({ weightLbs: 112.4, weighedOn: "2026-03-01" });
  });
});

describe("scaleEntriesFromWeighInPayload", () => {
  it("reads live robot-weigh-in entries and ignores setup / empty payloads", () => {
    expect(scaleEntriesFromWeighInPayload({ status: "setup_required", entries: [] })).toEqual([]);
    expect(scaleEntriesFromWeighInPayload({ status: "live" })).toEqual([]);
    expect(
      scaleEntriesFromWeighInPayload({
        status: "live",
        entries: [
          { weightLbs: "119.50", weighedOn: "2026-02-08" },
          { weightLbs: 110, weighedOn: "2026-01-20" },
        ],
      }),
    ).toEqual([
      { weightLbs: 119.5, weighedOn: "2026-02-08" },
      { weightLbs: 110, weighedOn: "2026-01-20" },
    ]);
  });

  it("does not treat bomEstimatedLbs or a summary as a third scale", () => {
    const entries = scaleEntriesFromWeighInPayload({
      status: "live",
      bomEstimatedLbs: 99,
      summary: { latestWeightLbs: 130 },
      entries: [],
    });
    expect(entries).toEqual([]);
    expect(isCloseBlank(closePlannedAgainstWeighIn(99, entries))).toBe(true);
  });
});
