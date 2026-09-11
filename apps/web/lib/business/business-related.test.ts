import { describe, expect, it } from "vitest";
import {
  businessRelatedLinks,
  AWARDS_RELATED_INCLUDE,
  BUSINESS_FUNDING_RELATED_INCLUDE,
  BUSINESS_GRANTS_RELATED_INCLUDE,
  COSTS_RELATED_INCLUDE,
  FUNDRAISERS_RELATED_INCLUDE,
  GRANTS_WRITING_RELATED_INCLUDE,
  IMPACT_RELATED_INCLUDE,
  ORDERS_RELATED_INCLUDE,
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

  it("this week's funding strip is Sponsors, Budget, and Grants", () => {
    expect([...BUSINESS_FUNDING_RELATED_INCLUDE]).toEqual(["sponsors", "budget", "grants"]);
    const links = businessRelatedLinks("org-1", { include: [...BUSINESS_FUNDING_RELATED_INCLUDE] });
    expect(links.map((link) => link.id)).toEqual(["sponsors", "grants", "budget"]);
    expect(links.find((link) => link.id === "sponsors")?.href).toBe("/business?tab=sponsors&orgId=org-1");
    expect(links.find((link) => link.id === "budget")?.href).toBe("/business?tab=budget&orgId=org-1");
    expect(links.find((link) => link.id === "grants")?.href).toBe("/business?tab=grants&orgId=org-1");
  });

  it("builds fundraisers Soft-UI cross-links to sponsors, grants, orders, and season costs", () => {
    const links = businessRelatedLinks("org-1", {
      active: "fundraisers",
      include: FUNDRAISERS_RELATED_INCLUDE,
    });
    expect(links.map((l) => l.id)).toEqual(["finance", "sponsors", "orders", "grants", "costs", "finance-ai", "budget"]);
    expect(links.find((l) => l.id === "sponsors")?.href).toBe("/business?tab=sponsors&orgId=org-1");
    expect(links.find((l) => l.id === "grants")?.href).toBe("/business?tab=grants&orgId=org-1");
    expect(links.find((l) => l.id === "orders")?.href).toBe("/business?tab=orders&orgId=org-1");
    expect(links.find((l) => l.id === "costs")?.href).toBe("/costs?orgId=org-1");
  });

  it("builds orders Soft-UI cross-links to sponsors, fundraisers, and season costs", () => {
    const links = businessRelatedLinks("org-1", {
      active: "orders",
      include: ORDERS_RELATED_INCLUDE,
    });
    expect(links.map((l) => l.id)).toEqual(["finance", "sponsors", "grants", "fundraisers", "costs", "finance-ai", "budget"]);
    expect(links.find((l) => l.id === "sponsors")?.href).toBe("/business?tab=sponsors&orgId=org-1");
    expect(links.find((l) => l.id === "fundraisers")?.href).toBe("/fundraisers?orgId=org-1");
    expect(links.find((l) => l.id === "costs")?.href).toBe("/costs?orgId=org-1");
    expect(links.find((l) => l.id === "budget")?.href).toBe("/business?tab=budget&orgId=org-1");
  });

  it("builds Season Costs Soft-UI cross-links to Orders, Fundraisers, and Business budget", () => {
    const links = businessRelatedLinks("org-1", {
      active: "costs",
      include: COSTS_RELATED_INCLUDE,
    });
    expect(links.map((l) => l.id)).toEqual(["finance", "orders", "fundraisers", "finance-ai", "budget"]);
    expect(links.find((l) => l.id === "orders")?.href).toBe("/business?tab=orders&orgId=org-1");
    expect(links.find((l) => l.id === "fundraisers")?.href).toBe("/fundraisers?orgId=org-1");
    expect(links.find((l) => l.id === "budget")?.href).toBe("/business?tab=budget&orgId=org-1");
  });

  it("builds Community Impact Soft-UI cross-links to Awards, Outreach, and Writer", () => {
    const links = businessRelatedLinks("org-1", {
      active: "impact",
      include: IMPACT_RELATED_INCLUDE,
    });
    expect(links.map((l) => l.id)).toEqual(["evidence", "awards", "writer"]);
    expect(links.find((l) => l.id === "awards")?.href).toBe("/team/awards?orgId=org-1");
    expect(links.find((l) => l.id === "evidence")?.href).toBe("/business?tab=evidence&orgId=org-1");
    expect(links.find((l) => l.id === "writer")?.href).toBe("/writer?orgId=org-1");
  });

  it("builds Awards workbench Soft-UI cross-links to impact, outreach, and writer", () => {
    const links = businessRelatedLinks("org-1", {
      active: "awards",
      include: AWARDS_RELATED_INCLUDE,
    });
    expect(links.map((l) => l.id)).toEqual(["evidence", "impact", "writer"]);
    expect(links.find((l) => l.id === "impact")?.href).toBe("/impact?orgId=org-1");
    expect(links.find((l) => l.id === "evidence")?.href).toBe("/business?tab=evidence&orgId=org-1");
    expect(links.find((l) => l.id === "writer")?.href).toBe("/writer?orgId=org-1");
  });

  it("never uses DEMO labels", () => {
    const links = businessRelatedLinks("org-1");
    expect(links.every((l) => !/demo/i.test(l.label))).toBe(true);
  });

  it("uses student words instead of CRM or workbench", () => {
    const links = businessRelatedLinks("org-1");
    expect(links.find((link) => link.id === "sponsors")?.label).toBe("Sponsors");
    expect(links.find((link) => link.id === "finance")?.label).toBe("Money");
    expect(links.find((link) => link.id === "evidence")?.label).toBe("Outreach");
    expect(links.find((link) => link.id === "grant-workbench")?.label).toBe("Grant writing");
    expect(links.find((link) => link.id === "finance-ai")?.label).toBe("Ask AI about money");
    expect(links.every((link) => !/\bCRM\b|workbench/i.test(link.label))).toBe(true);
  });
});
