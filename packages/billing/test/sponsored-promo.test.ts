import { describe, expect, it } from "vitest";
import {
  SPONSORED_PROMO_ENDS_AT,
  SPONSORED_PROMO_TEAM_NUMBER,
  evaluateSponsoredPromoEligibility,
  hasAnySponsoredProviderEnvKey,
  isSponsoredPromoWindowOpen,
} from "../src/sponsored-promo";

describe("sponsored promo eligibility", () => {
  it("allows team 1111 inside the window", () => {
    const status = evaluateSponsoredPromoEligibility({
      teamNumber: SPONSORED_PROMO_TEAM_NUMBER,
      now: new Date("2026-08-01T12:00:00.000Z"),
    });
    expect(status.eligible).toBe(true);
    if (status.eligible) {
      expect(status.fundingMode).toBe("sponsored");
      expect(status.endsAt).toBe(SPONSORED_PROMO_ENDS_AT.toISOString());
    }
  });

  it("denies after promoEndsAt", () => {
    const status = evaluateSponsoredPromoEligibility({
      teamNumber: 1111,
      now: new Date("2026-10-19T00:00:00.000Z"),
    });
    expect(status.eligible).toBe(false);
    if (!status.eligible) {
      expect(status.reason).toBe("promo_expired");
      expect(status.message).toMatch(/ended on 2026-10-18/);
      expect(status.message).toMatch(/keeps working/i);
    }
  });

  it("expiry is AI-pool eligibility only (no org lockout signal)", () => {
    const status = evaluateSponsoredPromoEligibility({
      teamNumber: 1111,
      now: new Date("2026-10-19T00:00:00.000Z"),
    });
    expect(status.eligible).toBe(false);
    if (!status.eligible) {
      expect(status.reason).toBe("promo_expired");
      // Status shape is sponsored-pool eligibility — never membership/hub access denial.
      expect(status).not.toHaveProperty("lockout");
      expect(status).not.toHaveProperty("membershipRevoked");
    }
  });

  it("denies other team numbers", () => {
    const status = evaluateSponsoredPromoEligibility({
      teamNumber: 254,
      now: new Date("2026-08-01T12:00:00.000Z"),
    });
    expect(status.eligible).toBe(false);
    if (!status.eligible) expect(status.reason).toBe("wrong_team");
  });

  it("reports window helpers", () => {
    expect(isSponsoredPromoWindowOpen(new Date("2026-10-18T12:00:00.000Z"))).toBe(true);
    expect(isSponsoredPromoWindowOpen(new Date("2026-10-19T00:00:00.000Z"))).toBe(false);
  });

  it("detects sponsored env keys by name only", () => {
    expect(hasAnySponsoredProviderEnvKey({})).toBe(false);
    expect(
      hasAnySponsoredProviderEnvKey({ MISTRAL_API_KEY: "x" } as NodeJS.ProcessEnv),
    ).toBe(true);
  });
});
