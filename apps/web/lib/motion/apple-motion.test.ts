import { describe, expect, it } from "vitest";
import {
  motionClassNames,
  motionLevelFromPreference,
  motionStyleVars,
  motionTokens,
  parsePrefersReducedMotion,
  staggerDelayMs,
} from "./apple-motion";

describe("apple-motion", () => {
  it("turns reduce into zero-duration tokens so the UI does not animate", () => {
    const tokens = motionTokens("reduce");
    expect(tokens.durationMs).toBe(0);
    expect(tokens.risePx).toBe(0);
    expect(tokens.pressScale).toBe(1);
    expect(staggerDelayMs(4, "reduce")).toBe(0);
    expect(motionClassNames("reduce").page).toBe("motion-static");
  });

  it("keeps full motion short and staggered, not bouncy", () => {
    const tokens = motionTokens("full");
    expect(tokens.durationMs).toBeLessThan(400);
    expect(tokens.risePx).toBeLessThanOrEqual(8);
    expect(staggerDelayMs(2, "full")).toBe(56);
    expect(motionClassNames("full").card).toBe("motion-card");
    expect(motionStyleVars(tokens)["--motion"]).toBe("240ms");
  });

  it("reads the prefers-reduced-motion media value", () => {
    expect(parsePrefersReducedMotion("reduce")).toBe(true);
    expect(motionLevelFromPreference(true)).toBe("reduce");
    expect(motionLevelFromPreference(false)).toBe("full");
  });
});
