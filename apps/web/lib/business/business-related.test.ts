import { describe, expect, it } from "vitest";
import {
  businessRelatedLinks,
  BUSINESS_GRANTS_RELATED_INCLUDE,
  FUNDRAISERS_RELATED_INCLUDE,
  GRANTS_WRITING_RELATED_INCLUDE,
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

  it("builds grant writing cross-links to sponsors, fundraisers, and writer", () => {
    const links = businessRelatedLinks("org-1", { include: GRANTS_WRITING_RELATED_INCLUDE });
    expect(links.map((l) => l.id)).toEqual([
      "sponsors",
      "grants",
      "fundraisers",
      "writer",
      "finance-ai",
    ]);
    expect(links.find((l) => l.id === "sponsors")?.href).toBe("/business?tab=sponsors&orgId=org-1");
    expect(links.find((l) => l.id === "fundraisers")?.href).toBe("/fundraisers?orgId=org-1");
    expect(links.find((l) => l.id === "writer")?.href).toBe("/writer?orgId=org-1");
  });

  it("builds Business Grants hub links to the writing workbench", () => {
    const links = businessRelatedLinks("org-1", { include: BUSINESS_GRANTS_RELATED_INCLUDE });
    expect(links.find((l) => l.id === "grant-workbench")?.href).toBe("/team/grants?orgId=org-1");
    expect(links.find((l) => l.id === "writer")?.href).toBe("/writer?orgId=org-1");
  });

  it("builds fundraisers Soft-UI cross-links to sponsors, grants, and orders", () => {
    const links = businessRelatedLinks("org-1", {
      active: "fundraisers",
      include: FUNDRAISERS_RELATED_INCLUDE,
    });
    expect(links.map((l) => l.id)).toEqual(["sponsors", "orders", "grants", "finance-ai", "budget"]);
    expect(links.find((l) => l.id === "sponsors")?.href).toBe("/business?tab=sponsors&orgId=org-1");
    expect(links.find((l) => l.id === "grants")?.href).toBe("/business?tab=grants&orgId=org-1");
    expect(links.find((l) => l.id === "orders")?.href).toBe("/business?tab=orders&orgId=org-1");
  });

  it("never uses DEMO labels", () => {
    const links = businessRelatedLinks("org-1");
    expect(links.every((l) => !/demo/i.test(l.label))).toBe(true);
  });
});
