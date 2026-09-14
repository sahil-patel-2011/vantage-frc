import { describe, expect, it } from "vitest";
import { looksLikeGeminiApiKey, onboardingAsksForGeminiKey } from "./gemini-key";

describe("onboarding Gemini key", () => {
  it("asks team heads of every number except 6925", () => {
    expect(onboardingAsksForGeminiKey({ isTeamHead: true, teamNumber: 254 })).toBe(true);
    expect(onboardingAsksForGeminiKey({ isTeamHead: true, teamNumber: 6925 })).toBe(false);
    expect(onboardingAsksForGeminiKey({ isTeamHead: false, teamNumber: 254 })).toBe(false);
    expect(onboardingAsksForGeminiKey({ isTeamHead: true, teamNumber: null })).toBe(false);
  });

  it("accepts Google AI Studio key shapes", () => {
    expect(looksLikeGeminiApiKey("AIzaSyTestKeyThatLooksLongEnough")).toBe(true);
    expect(looksLikeGeminiApiKey("AQ.placeholder-gemini-key-value")).toBe(true);
    expect(looksLikeGeminiApiKey("short")).toBe(false);
    expect(looksLikeGeminiApiKey("not a key with spaces!!!!!")).toBe(false);
  });
});
