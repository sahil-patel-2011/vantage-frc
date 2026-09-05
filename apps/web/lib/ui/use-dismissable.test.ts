import { describe, expect, it } from "vitest";
import { isOutsideTarget } from "./use-dismissable";

const box = (hits: unknown[]) => ({
  contains: (node: unknown) => hits.includes(node),
});

describe("isOutsideTarget", () => {
  it("treats a miss as outside", () => {
    expect(isOutsideTarget("page", [box(["menu"])])).toBe(true);
  });

  it("treats a hit on any root as inside", () => {
    const trigger = "trigger";
    const panel = "panel";
    expect(isOutsideTarget(trigger, [box([trigger, panel])])).toBe(false);
    expect(isOutsideTarget(panel, [box([trigger]), box([panel])])).toBe(false);
  });

  it("ignores null roots", () => {
    expect(isOutsideTarget("x", [null, undefined])).toBe(true);
  });
});
