import { describe, expect, it } from "vitest";
import {
  buildOnboardingStepMeta,
  onboardingCanSubmit,
  onboardingFundingReady,
  onboardingLoadCopy,
  onboardingMembershipNote,
  onboardingProgressLabel,
  onboardingStepIndex,
  onboardingStepPhase,
  onboardingLegalRequired,
} from "./onboarding-flow";
import { expectPlainCopy } from "../ui/copy-assertions";

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
    // Labels track ONBOARDING_STEP_COPY, which the rebuild renamed to
    // You → Your team → Finish. The step *ids* are still the server's contract.
    expect(onboardingProgressLabel("profile")).toBe("Step 1 of 3 · You");
    expect(onboardingProgressLabel("team")).toBe("Step 2 of 3 · Your team");
    expect(onboardingProgressLabel("preferences")).toBe("Step 3 of 3 · Finish");
    expect(onboardingProgressLabel("pending")).toMatch(/waiting for team approval/i);
    expect(onboardingProgressLabel("done")).toMatch(/team is open/i);
  });

  it("labels every dot in the 3-dot header", () => {
    expect(buildOnboardingStepMeta("profile").map((s) => s.label)).toEqual([
      "You",
      "Your team",
      "Finish",
    ]);
    // Each dot carries its own one-line explanation for the header hint.
    expect(buildOnboardingStepMeta("profile").every((s) => s.description.length > 10)).toBe(true);
  });

  it("asks for consent unless BOTH documents were already accepted", () => {
    expect(onboardingLegalRequired({ termsAcceptedAt: null, privacyAcceptedAt: null })).toBe(true);
    expect(onboardingLegalRequired({ termsAcceptedAt: "", privacyAcceptedAt: "" })).toBe(true);
    // Legacy 0163 combined checkbox is not evidence of a separate privacy consent.
    expect(
      onboardingLegalRequired({ termsAcceptedAt: "2026-07-01T00:00:00.000Z", privacyAcceptedAt: null }),
    ).toBe(true);
    expect(
      onboardingLegalRequired({
        termsAcceptedAt: "2026-07-01T00:00:00.000Z",
        privacyAcceptedAt: "2026-07-01T00:00:00.000Z",
      }),
    ).toBe(false);
  });

  it("cannot submit until both boxes are ticked", () => {
    const pending = { termsAcceptedAt: null, privacyAcceptedAt: null };
    expect(onboardingCanSubmit({ termsAccepted: false, privacyAccepted: false, ...pending })).toBe(false);
    expect(onboardingCanSubmit({ termsAccepted: true, privacyAccepted: false, ...pending })).toBe(false);
    expect(onboardingCanSubmit({ termsAccepted: false, privacyAccepted: true, ...pending })).toBe(false);
    expect(onboardingCanSubmit({ termsAccepted: true, privacyAccepted: true, ...pending })).toBe(true);
  });

  it("skips the gate only when both timestamps already exist", () => {
    expect(
      onboardingCanSubmit({
        termsAccepted: false,
        privacyAccepted: false,
        termsAcceptedAt: "2026-07-01",
        privacyAcceptedAt: "2026-07-01",
      }),
    ).toBe(true);
    expect(
      onboardingCanSubmit({
        termsAccepted: false,
        privacyAccepted: false,
        termsAcceptedAt: "2026-07-01",
        privacyAcceptedAt: null,
      }),
    ).toBe(false);
  });

  it("requires affiliation and a funding path for team heads", () => {
    expect(
      onboardingFundingReady({
        isTeamHead: false,
        teamAffiliation: null,
        schoolFunded: false,
        outsideGrants: false,
        sponsorsAllowed: false,
      }),
    ).toBe(true);
    expect(
      onboardingFundingReady({
        isTeamHead: true,
        teamAffiliation: null,
        schoolFunded: true,
        outsideGrants: false,
        sponsorsAllowed: false,
      }),
    ).toBe(false);
    expect(
      onboardingFundingReady({
        isTeamHead: true,
        teamAffiliation: "private_school",
        schoolFunded: false,
        outsideGrants: false,
        sponsorsAllowed: false,
      }),
    ).toBe(false);
    expect(
      onboardingFundingReady({
        isTeamHead: true,
        teamAffiliation: "community",
        schoolFunded: false,
        outsideGrants: true,
        sponsorsAllowed: false,
      }),
    ).toBe(true);
  });

  it("keeps closed-membership copy honest for empty/setup shells", () => {
    expect(onboardingLoadCopy("loading").title).toMatch(/Loading/i);
    expectPlainCopy(onboardingLoadCopy("error").description);
    expect(onboardingLoadCopy("setup_required").badge).toBe("Setup required");
    expect(onboardingLoadCopy("setup_required", "Sign in required.").description).toBe("Sign in required.");
    expect(onboardingMembershipNote("none").body).toMatch(/cannot join/i);
    expect(onboardingMembershipNote("none", { preferredTeamNumber: 254 }).body).toMatch(/approval/i);
    expect(onboardingMembershipNote("invited").body).toMatch(/invite/i);
    expect(onboardingMembershipNote("pending").body).toMatch(/owners|approve/i);
  });
});
