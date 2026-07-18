import { describe, expect, it } from "vitest";
import {
  businessRelatedLinks,
  PLACEMENTS_RELATED_INCLUDE,
  SPONSOR_CRM_RELATED_INCLUDE,
} from "./business-related";

describe("business-related Soft-UI helpers", () => {
  it("builds org-scoped Business hub and Finance-in-AI cross-links", () => {
    const links = businessRelatedLinks("org-1", { include: SPONSOR_CRM_RELATED_INCLUDE });
    expect(links.find((l) => l.id === "placements")?.href).toBe("/business?tab=placements&orgId=org-1");
    expect(links.find((l) => l.id === "fundraisers")?.href).toBe("/fundraisers?orgId=org-1");
    expect(links.find((l) => l.id === "grants")?.href).toBe("/business?tab=grants&orgId=org-1");
    expect(links.find((l) => l.id === "orders")?.href).toBe("/business?tab=orders&orgId=org-1");
    expect(links.find((l) => l.id === "finance-ai")?.href).toBe("/ai?tab=finance&orgId=org-1");
  });

  it("excludes the active surface and keeps placements include set", () => {
    const links = businessRelatedLinks("org-1", {
      active: "sponsors",
      include: PLACEMENTS_RELATED_INCLUDE,
    });
    expect(links.map((l) => l.id)).toEqual([
      "sponsorship",
      "orders",
      "fundraisers",
      "finance-ai",
    ]);
  });

  it("never uses DEMO labels", () => {
    const links = businessRelatedLinks("org-1");
    expect(links.every((l) => !/demo/i.test(l.label))).toBe(true);
  });
});
