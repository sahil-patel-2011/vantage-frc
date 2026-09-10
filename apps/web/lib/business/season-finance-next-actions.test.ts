import { describe, expect, it } from "vitest";
import { seasonFinanceNextActions } from "./season-finance-next-actions";

describe("season finance next actions", () => {
  it("asks for a team when none is selected", () => {
    const actions = seasonFinanceNextActions({});
    expect(actions[0]?.id).toBe("workspace");
    expect(actions[0]?.href).toBe("/workspace");
  });

  it("points at first funding and purchase log when the desk is empty", () => {
    const actions = seasonFinanceNextActions({
      orgId: "org-1",
      seasonYear: 2026,
      fundingCount: 0,
      purchaseCount: 0,
      plannedSpendCents: 0,
      canManageFinance: true,
    });
    expect(actions.map((action) => action.id)).toEqual([
      "first-funding",
      "first-purchase",
      "budget",
      "sponsors",
      "orders",
    ]);
    expect(actions[0]?.href).toContain("/business?tab=finance");
    expect(actions.every((action) => !/demo/i.test(action.detail))).toBe(true);
  });

  it("surfaces a funding gap from logged remaining-to-raise only", () => {
    const actions = seasonFinanceNextActions({
      orgId: "org-1",
      fundingCount: 2,
      purchaseCount: 3,
      remainingToRaiseCents: 25_000_00,
      reimbursementOpenCents: 50_00,
    });
    expect(actions[0]?.id).toBe("gap");
    expect(actions.some((action) => action.id === "reimburse")).toBe(true);
  });
});
