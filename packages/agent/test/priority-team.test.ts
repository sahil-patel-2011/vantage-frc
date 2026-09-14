import { describe, expect, it } from "vitest";
import {
  isGeminiOnlyTeam,
  isPriorityFreebuffTeam,
  teamNeedsOwnGeminiKey,
} from "../src/priority-team";

describe("priority team Gemini pin", () => {
  it("pins only FRC 6925 to Gemini", () => {
    expect(isGeminiOnlyTeam(6925)).toBe(true);
    expect(isGeminiOnlyTeam(254)).toBe(false);
    expect(isGeminiOnlyTeam(null)).toBe(false);
    expect(isPriorityFreebuffTeam(6925)).toBe(true);
  });

  it("asks every other real team number for its own Gemini key", () => {
    expect(teamNeedsOwnGeminiKey(254)).toBe(true);
    expect(teamNeedsOwnGeminiKey(6925)).toBe(false);
    expect(teamNeedsOwnGeminiKey(null)).toBe(false);
    expect(teamNeedsOwnGeminiKey(undefined)).toBe(false);
  });
});
