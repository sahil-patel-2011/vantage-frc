import { describe, expect, it } from "vitest";
import { ordersNextActions } from "./orders-next-actions";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("ordersNextActions Soft-UI helpers", () => {
  it("routes missing workspace to /workspace", () => {
    const actions = ordersNextActions({});
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ id: "workspace", href: "/workspace", primary: true });
  });

  it("points empty season at first submit and Sponsors / Fundraisers", () => {
    const actions = ordersNextActions({ orgId: "org-1", orderCount: 0, seasonYear: 2026 });
    expect(actions.map((a) => a.id)).toEqual(["submit", "sponsors", "fundraisers", "budget"]);
    expect(actions[0]?.href).toContain("/orders");
    expect(actions[0]?.href).toContain("orgId=org-1");
    expect(actions.find((a) => a.id === "sponsors")?.href).toBe("/business?tab=sponsors&orgId=org-1");
    expect(actions.find((a) => a.id === "fundraisers")?.href).toBe("/fundraisers?orgId=org-1");
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
    actions.forEach((a) => expectPlainCopy(a.detail));
  });

  it("routes admins to approve awaiting requests", () => {
    const actions = ordersNextActions({
      orgId: "org-1",
      isAdmin: true,
      orderCount: 3,
      pendingCount: 2,
      readyToBuyCount: 1,
    });
    expect(actions[0]).toMatchObject({
      id: "approve",
      primary: true,
      href: "/business?tab=orders&orgId=org-1",
    });
    expect(actions[0]?.detail).toMatch(/buy link/i);
    expect(actions[0]?.detail).toMatch(/never collected/i);
  });

  it("tells non-admins when requests wait on mentors", () => {
    const actions = ordersNextActions({
      orgId: "org-1",
      isAdmin: false,
      orderCount: 2,
      pendingCount: 1,
    });
    expect(actions[0]?.id).toBe("waiting");
  });

  it("prioritizes missing buy links then ready-to-order", () => {
    const missing = ordersNextActions({
      orgId: "org-1",
      orderCount: 2,
      readyToBuyCount: 2,
      missingBuyLinkCount: 1,
    });
    expect(missing[0]?.id).toBe("buy-link");

    const ready = ordersNextActions({
      orgId: "org-1",
      orderCount: 2,
      readyToBuyCount: 2,
      missingBuyLinkCount: 0,
    });
    expect(ready[0]?.id).toBe("buy");
    expect(ready[0]?.detail).toMatch(/vendor site/i);
  });
});
