import { describe, expect, it } from "vitest";
import {
  buildOnboardingStepMeta,
  onboardingCanSubmit,
  onboardingLoadCopy,
  onboardingMembershipNote,
  onboardingProgressLabel,
  onboardingStepIndex,
  onboardingStepPhase,
  onboardingTermsRequired,
} from "./onboarding-flow";

describe("onboarding Soft-UI flow helpers", () => {
  it("maps setup steps with done/current/upcoming phases", () => {
    const meta = buildOnboardingStepMeta("team");
    expect(meta.map((s) => s.phase)).toEqual(["done", "current", "upcoming"]);
    expect(onboardingStepPhase("profile", "preferences")).toBe("done");
    expect(onboardingStepPhase("preferences", "preferences")).toBe("current");
    expect(onboardingStepIndex("pending")).toBe(3);
    expect(buildOnboardingStepMeta("pending").every((s) => s.phase === "done")).toBe(true);
  });

  it("builds readable progress labels", () => {
    expect(onboardingProgressLabel("profile")).toBe("Step 1 of 3 · You");
    expect(onboardingProgressLabel("team")).toBe("Step 2 of 3 · Team & focus");
    expect(onboardingProgressLabel("preferences")).toBe("Step 3 of 3 · Review");
    expect(onboardingProgressLabel("pending")).toMatch(/waiting for team approval/i);
  });

  it("requires terms only when not previously accepted", () => {
    expect(onboardingTermsRequired(null)).toBe(true);
    expect(onboardingTermsRequired("")).toBe(true);
    expect(onboardingTermsRequired("2026-07-01T00:00:00.000Z")).toBe(false);
    expect(onboardingCanSubmit({ termsAccepted: false, termsAcceptedAt: null })).toBe(false);
    expect(onboardingCanSubmit({ termsAccepted: true, termsAcceptedAt: null })).toBe(true);
    expect(onboardingCanSubmit({ termsAccepted: false, termsAcceptedAt: "2026-07-01" })).toBe(true);
  });

  it("keeps closed-membership copy honest for empty/setup shells", () => {
    expect(onboardingLoadCopy("loading").title).toMatch(/Loading/i);
    expect(onboardingLoadCopy("error").description).toMatch(/DEMO/i);
    expect(onboardingLoadCopy("setup_required").badge).toBe("Setup required");
    expect(onboardingLoadCopy("setup_required", "Sign in required.").description).toBe("Sign in required.");
    expect(onboardingMembershipNote("none").title).toMatch(/Closed membership/i);
    expect(onboardingMembershipNote("invited").body).toMatch(/invite/i);
    expect(onboardingMembershipNote("pending").body).toMatch(/approve/i);
  });
});
