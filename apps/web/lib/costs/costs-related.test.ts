import { describe, expect, it } from "vitest";
import {
  COSTS_BUSINESS_RELATED_INCLUDE,
  formatBudgetPctDisplay,
  formatCostUsdDisplay,
  costsRelatedLinks,
} from "./costs-related";

describe("costs-related Soft-UI helpers", () => {
  it("builds Orders / Fundraisers / Budget cross-links", () => {
    const links = costsRelatedLinks("org-1");
    expect(links.find((l) => l.id === "orders")?.href).toBe("/business?tab=orders&orgId=org-1");
    expect(links.find((l) => l.id === "fundraisers")?.href).toBe("/fundraisers?orgId=org-1");
    expect(links.find((l) => l.id === "budget")?.href).toBe("/business?tab=budget&orgId=org-1");
    expect(links.find((l) => l.id === "finance-ai")?.href).toBe("/ai?tab=finance&orgId=org-1");
  });

  it("excludes active and respects include", () => {
    const links = costsRelatedLinks("org-1", {
      active: "finance-ai",
      include: ["orders", "fundraisers"],
    });
    expect(links.map((l) => l.id)).toEqual(["orders", "fundraisers"]);
  });

  it("never uses DEMO labels", () => {
    const links = costsRelatedLinks("org-1");
    expect(links.every((l) => !/demo/i.test(l.label))).toBe(true);
    expect(COSTS_BUSINESS_RELATED_INCLUDE.every((id) => !/demo/i.test(id))).toBe(true);
    expect(COSTS_BUSINESS_RELATED_INCLUDE).toEqual(
      expect.arrayContaining(["orders", "fundraisers", "budget", "finance-ai"]),
    );
  });

  it("hides dollars and % until real evidence exists", () => {
    expect(formatCostUsdDisplay(0, false)).toBe("—");
    expect(formatCostUsdDisplay(12500, true)).toBe("$12,500");
    expect(formatBudgetPctDisplay(null)).toBe("—");
    expect(formatBudgetPctDisplay(0.42)).toBe("42%");
  });
});
