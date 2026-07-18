import { describe, expect, it } from "vitest";
import { billingDisplayStatus, stripeWiringSnapshot } from "./admin-org-plans";

describe("billingDisplayStatus", () => {
  it("maps missing entitlement to free", () => {
    expect(billingDisplayStatus({ planCode: null, entitlementStatus: null, entitlementSource: null })).toBe(
      "free",
    );
  });

  it("maps free plan to free", () => {
    expect(
      billingDisplayStatus({ planCode: "free", entitlementStatus: "active", entitlementSource: "stripe" }),
    ).toBe("free");
  });

  it("maps trialing and admin trials", () => {
    expect(
      billingDisplayStatus({
        planCode: "team_pro",
        entitlementStatus: "trialing",
        entitlementSource: "stripe",
      }),
    ).toBe("trial");
    expect(
      billingDisplayStatus({
        planCode: "team_trial",
        entitlementStatus: "active",
        entitlementSource: "admin_trial",
      }),
    ).toBe("trial");
  });

  it("maps active paid and past_due", () => {
    expect(
      billingDisplayStatus({
        planCode: "team_max",
        entitlementStatus: "active",
        entitlementSource: "stripe",
      }),
    ).toBe("active");
    expect(
      billingDisplayStatus({
        planCode: "team_pro",
        entitlementStatus: "past_due",
        entitlementSource: "stripe",
      }),
    ).toBe("past_due");
  });

  it("maps revoked/expired to free", () => {
    expect(
      billingDisplayStatus({
        planCode: "team_pro",
        entitlementStatus: "revoked",
        entitlementSource: "admin_trial",
      }),
    ).toBe("free");
  });
});

describe("stripeWiringSnapshot", () => {
  it("lists blockers when Stripe is not wired", () => {
    const snap = stripeWiringSnapshot({
      secretConfigured: false,
      webhookConfigured: false,
      billingDbConfigured: false,
      plansWithStripePriceId: 0,
    });
    expect(snap.blockers.length).toBeGreaterThanOrEqual(3);
  });

  it("is clear when env and price IDs exist", () => {
    const snap = stripeWiringSnapshot({
      secretConfigured: true,
      webhookConfigured: true,
      billingDbConfigured: true,
      plansWithStripePriceId: 4,
    });
    expect(snap.blockers).toEqual([]);
  });
});
