import { describe, expect, it } from "vitest";
import { priorForEvent } from "./card-strength";

describe("card strength file", () => {
  it("loads priors only when the event start date is known", () => {
    expect(priorForEvent("2026hop", null)).toBeNull();
    const prior = priorForEvent("2026hop", "2026-04-29");
    expect(prior).not.toBeNull();
    expect(prior?.size ?? 0).toBeGreaterThan(100);
    expect(prior?.has("frc0000")).toBe(false);
  });
});