import { describe, expect, it } from "vitest";
import { sponsorCrmNextActions } from "./sponsor-crm-next-actions";

describe("sponsorCrmNextActions Soft-UI helpers", () => {
  it("requires a workspace before CRM setup", () => {
    const actions = sponsorCrmNextActions({ surface: "sponsors" });
    expect(actions).toHaveLength(1);
    expect(actions[0]?.id).toBe("workspace");
    expect(actions[0]?.href).toBe("/workspace");
  });

  it("points empty CRM at goal, fundraisers, and grants — never DEMO metrics", () => {
    const actions = sponsorCrmNextActions({
      orgId: "org-1",
      surface: "sponsors",
      canManage: true,
      sponsorCount: 0,
      fundraisingGoalCents: 0,
    });
    expect(actions.some((a) => a.id === "goal")).toBe(true);
    expect(actions.some((a) => a.id === "fundraisers")).toBe(true);
    expect(actions.some((a) => a.id === "grants")).toBe(true);
    expect(actions.every((a) => !/demo/i.test(`${a.label} ${a.detail}`))).toBe(true);
  });

  it("routes populated CRM toward packages, orders, and Finance-in-AI", () => {
    const actions = sponsorCrmNextActions({
      orgId: "org-1",
      surface: "sponsors",
      canManage: true,
      sponsorCount: 3,
      reminderCount: 0,
      fundraisingGoalCents: 50_000_00,
    });
    expect(actions.map((a) => a.id)).toEqual(["packages", "orders", "finance-ai"]);
    expect(actions.find((a) => a.id === "finance-ai")?.href).toBe("/ai?tab=finance&orgId=org-1");
  });

  it("keeps placements next actions org-scoped and sponsor-first", () => {
    const actions = sponsorCrmNextActions({
      orgId: "org-1",
      surface: "placements",
      canManage: true,
      sponsorCount: 0,
      packageCount: 0,
    });
    expect(actions[0]?.id).toBe("sponsors-first");
    expect(actions[0]?.href).toBe("/business?tab=sponsors&orgId=org-1");
    expect(actions.every((a) => !/demo/i.test(a.label))).toBe(true);
  });
});
