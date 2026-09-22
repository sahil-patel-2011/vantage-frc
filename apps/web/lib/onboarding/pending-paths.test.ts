import { describe, expect, it } from "vitest";
import { buildOnboardingPendingPlan } from "./step-model";
import { isPendingWorkspacePath } from "./pending-paths";

describe("isPendingWorkspacePath", () => {
  it("lets a waiting person open the links the pending screen offers", () => {
    const plans = [
      buildOnboardingPendingPlan({ accessStatus: "pending", teamNumber: 1234, orgName: "Robo Rangers", adult: false }),
      buildOnboardingPendingPlan({ accessStatus: "invited", teamNumber: 1234, orgName: null, adult: true }),
      buildOnboardingPendingPlan({ accessStatus: "declined", teamNumber: 1234, orgName: null, adult: true }),
      buildOnboardingPendingPlan({ accessStatus: "none", teamNumber: 1234, orgName: null, adult: true }),
      buildOnboardingPendingPlan({ accessStatus: "none", teamNumber: null, orgName: null, adult: false }),
    ];
    const hrefs = plans.flatMap((plan) => plan.meanwhile.map((link) => link.href));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(isPendingWorkspacePath(href), href).toBe(true);
    }
  });

  it("keeps the team product closed until someone is actually a member", () => {
    expect(isPendingWorkspacePath("/dashboard")).toBe(false);
    expect(isPendingWorkspacePath("/team")).toBe(false);
    expect(isPendingWorkspacePath("/scouting")).toBe(false);
    expect(isPendingWorkspacePath("/api/scouting")).toBe(false);
    expect(isPendingWorkspacePath("/api/media")).toBe(false);
    expect(isPendingWorkspacePath("/admin")).toBe(false);
  });

  it("allows the account and manual APIs those pages call", () => {
    expect(isPendingWorkspacePath("/api/me")).toBe(true);
    expect(isPendingWorkspacePath("/api/account")).toBe(true);
    expect(isPendingWorkspacePath("/api/account/phone-otp")).toBe(true);
    expect(isPendingWorkspacePath("/api/branding/appearance")).toBe(true);
    expect(isPendingWorkspacePath("/api/navigation/preferences")).toBe(true);
    expect(isPendingWorkspacePath("/api/security/mfa")).toBe(true);
    expect(isPendingWorkspacePath("/api/roadmap")).toBe(true);
    expect(isPendingWorkspacePath("/docs/scouting")).toBe(true);
    expect(isPendingWorkspacePath("/help/signing-in")).toBe(true);
    expect(isPendingWorkspacePath("/claim")).toBe(true);
  });
});
