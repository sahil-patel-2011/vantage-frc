import { describe, expect, it } from "vitest";
import {
  ACCOUNT_RELATED_INCLUDE,
  accountNextActions,
  accountRelatedLinks,
  formatAccountOrgLabel,
  formatAccountRole,
} from "./account-related";

describe("accountRelatedLinks", () => {
  it("builds Billing / Usage / Support / What’s new cross-links", () => {
    const links = accountRelatedLinks("org-1", { include: [...ACCOUNT_RELATED_INCLUDE] });
    expect(links.map((l) => l.id)).toEqual(["billing", "usage", "support", "whats-new"]);
    expect(links.find((l) => l.id === "billing")?.href).toBe("/ai?tab=budgets&orgId=org-1");
    expect(links.find((l) => l.id === "usage")?.href).toBe("/team/usage?orgId=org-1");
    expect(links.find((l) => l.id === "support")?.href).toBe("/support");
    expect(links.find((l) => l.id === "whats-new")?.href).toBe("/whats-new");
  });

  it("excludes active and respects include", () => {
    const links = accountRelatedLinks("org-1", {
      active: "usage",
      include: ["billing", "usage", "support"],
    });
    expect(links.map((l) => l.id)).toEqual(["billing", "support"]);
  });

  it("never uses DEMO labels", () => {
    const links = accountRelatedLinks("org-1");
    expect(links.every((l) => !/demo/i.test(l.label))).toBe(true);
    expect(ACCOUNT_RELATED_INCLUDE).toEqual(["billing", "usage", "support", "whats-new"]);
  });
});

describe("formatAccountOrgLabel", () => {
  it("stays blank without an org membership", () => {
    expect(
      formatAccountOrgLabel({
        orgId: null,
        orgName: "Ghost",
        teamNumber: 1234,
        role: "admin",
        planCode: "pro",
      }),
    ).toBeNull();
  });

  it("joins real team / name / role context", () => {
    expect(
      formatAccountOrgLabel({
        orgId: "org-1",
        orgName: "Vantage Robotics",
        teamNumber: 254,
        role: "admin",
        planCode: "pro",
      }),
    ).toBe("Team 254 · Vantage Robotics · Admin");
    expect(formatAccountRole("owner")).toBe("Owner");
    expect(formatAccountRole(null)).toBeNull();
  });
});

describe("accountNextActions", () => {
  it("prioritizes workspace selection when no org is active", () => {
    const actions = accountNextActions({ orgId: null });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.some((a) => a.id === "support")).toBe(true);
    expect(actions.every((a) => !/demo/i.test(a.label))).toBe(true);
  });

  it("points at billing and usage for a live workspace", () => {
    const actions = accountNextActions({
      orgId: "org-1",
      hasProfile: true,
      emailDeliveryReady: true,
      googleReady: true,
      tbaReady: true,
    });
    expect(actions[0]?.id).toBe("billing");
    expect(actions.find((a) => a.id === "usage")?.href).toBe("/team/usage?orgId=org-1");
    expect(actions.some((a) => a.id === "whats-new")).toBe(true);
    expect(actions.some((a) => a.id === "support")).toBe(true);
  });

  it("surfaces email setup without inventing delivery", () => {
    const actions = accountNextActions({
      orgId: "org-1",
      hasProfile: true,
      emailDeliveryReady: false,
      googleReady: true,
      tbaReady: true,
    });
    expect(actions[0]?.id).toBe("email-setup");
    expect(actions[0]?.detail.toLowerCase()).toContain("resend");
  });
});
