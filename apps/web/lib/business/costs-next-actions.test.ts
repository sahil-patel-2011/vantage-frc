import { describe, expect, it } from "vitest";
import { costsNextActions } from "./costs-next-actions";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("costsNextActions Soft-UI helpers", () => {
  it("routes missing workspace to /workspace", () => {
    const actions = costsNextActions({});
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ id: "workspace", href: "/workspace", primary: true });
  });

  it("points unset budget at Season Costs plus Orders / Fundraisers / Business", () => {
    const actions = costsNextActions({ orgId: "org-1", seasonYear: 2026, budgetUsd: null, costCount: 0 });
    expect(actions.map((a) => a.id)).toEqual(["set-budget", "orders", "fundraisers", "budget"]);
    expect(actions[0]?.href).toContain("/costs");
    expect(actions[0]?.href).toContain("orgId=org-1");
    expect(actions[0]?.href).toContain("season=2026");
    expect(actions.find((a) => a.id === "orders")?.href).toBe("/business?tab=orders&orgId=org-1");
    expect(actions.find((a) => a.id === "fundraisers")?.href).toBe("/fundraisers?orgId=org-1");
    expect(actions.find((a) => a.id === "budget")?.href).toBe("/business?tab=budget&orgId=org-1");
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
    actions.forEach((a) => expectPlainCopy(a.detail));
  });

  it("asks for first cost when budget exists but nothing is logged", () => {
    const actions = costsNextActions({
      orgId: "org-1",
      budgetUsd: 25000,
      costCount: 0,
      subscriptionCount: 0,
    });
    expect(actions[0]).toMatchObject({ id: "first-cost", primary: true });
    expect(actions[0]?.detail).toMatch(/\$0 until|not placeholders/i);
  });

  it("surfaces over-budget review when committed exceeds budget", () => {
    const actions = costsNextActions({
      orgId: "org-1",
      budgetUsd: 10000,
      costCount: 3,
      overBudget: true,
    });
    expect(actions[0]?.id).toBe("over-budget");
  });
});
