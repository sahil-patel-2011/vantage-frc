import { describe, expect, it } from "vitest";
import {
  buildGrantReportNarrative,
  buildGrantReportSections,
  grantAllocationFromMetadata,
} from ".";

const BASE = {
  grantName: "NASA Grant",
  funder: "NASA",
  seasonYear: 2026,
  amountAwardedUsd: 2000,
  outreachByKind: [{ kind: "grant_followup", count: 2 }],
};

describe("buildGrantReportSections spend honesty", () => {
  it("refuses to include supplied spend without explicit attribution", () => {
    const sections = buildGrantReportSections({
      ...BASE,
      spendByCategory: [
        { category: "Robot parts", totalUsd: 800, count: 2 },
        { category: "Travel", totalUsd: 200, count: 1 },
      ],
    });

    const spend = sections.find((section) => section.id === "spend");
    expect(spend).toBeDefined();
    expect(spend?.title).toBe("Grant-attributed spend unavailable");
    expect(spend?.body).toContain("Spend linkage is not configured");
    expect(spend?.body).toContain("No season-wide expense is included");
    expect(spend?.body).not.toContain("$1,000");
  });

  it("stays honest when no season expenses are recorded at all", () => {
    const sections = buildGrantReportSections({ ...BASE, spendByCategory: [] });

    const spend = sections.find((section) => section.id === "spend");
    expect(spend?.title).toBe("Grant-attributed spend unavailable");
    expect(spend?.body).toContain("Spend linkage is not configured");
    expect(spend?.body).toContain("No season-wide expense is included");
  });

  it("keeps the disclosure in the assembled narrative", () => {
    const narrative = buildGrantReportNarrative(
      buildGrantReportSections({
        ...BASE,
        spendByCategory: [{ category: "Robot parts", totalUsd: 500, count: 1 }],
      }),
    );
    expect(narrative).toContain("Spend linkage is not configured");
    expect(narrative).not.toContain("Recorded fund usage");
  });

  it("cites only explicit grant-linked spend when attribution is set", () => {
    const sections = buildGrantReportSections({
      ...BASE,
      spendByCategory: [
        { category: "Robot parts", totalUsd: 150, count: 1 },
        { category: "Travel", totalUsd: 75.56, count: 1 },
      ],
      spendAttribution: "explicit",
    });
    const spend = sections.find((section) => section.id === "spend");
    expect(spend?.title).toBe("Grant-attributed spend");
    expect(spend?.body).toContain("$225.56");
    expect(spend?.body).not.toContain("Spend linkage is not configured");
  });

  it("does not substitute season totals when the schema exists but nothing is tagged", () => {
    const sections = buildGrantReportSections({
      ...BASE,
      spendByCategory: [],
      spendAttribution: "explicit",
    });
    const spend = sections.find((section) => section.id === "spend");
    expect(spend?.title).toBe("No grant-linked expenses");
    expect(spend?.body).toContain("Season-wide expenses are excluded");
    expect(spend?.body).not.toContain("Spend linkage is not configured");
  });
});

describe("grantAllocationFromMetadata", () => {
  it("accepts only metadata explicitly allocated to the requested grant", () => {
    expect(
      grantAllocationFromMetadata(
        { grantApplicationId: "grant-1", allocatedAmountUsd: 125.555, category: "Parts" },
        "grant-1",
      ),
    ).toEqual({ amountUsd: 125.56, category: "Parts" });
    expect(
      grantAllocationFromMetadata(
        { grantApplicationId: "grant-2", allocatedAmountUsd: 125 },
        "grant-1",
      ),
    ).toBeNull();
  });
});
