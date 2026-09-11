import { describe, expect, it } from "vitest";
import { currentOnboardingStep } from "./onboarding-card-model";

describe("onboarding Home card", () => {
  it("names only the next incomplete step", () => {
    expect(
      currentOnboardingStep([
        { key: "team", label: "Your team", detail: "On a team", done: true, href: "/workspace" },
        { key: "event", label: "Set active event", detail: "Pick the event", done: false, href: "/command" },
        { key: "tba", label: "Connect TBA", detail: "Match data", done: false, href: "/team/data" },
      ])?.key,
    ).toBe("event");
    expect(currentOnboardingStep([{ key: "team", label: "Your team", detail: "On a team", done: true, href: "/" }])).toBeNull();
  });
});
