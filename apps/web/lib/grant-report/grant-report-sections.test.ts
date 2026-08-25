import { describe, expect, it } from "vitest";
import { buildGrantReportNarrative, buildGrantReportSections } from ".";

const BASE = {
  grantName: "NASA Grant",
  funder: "NASA",
  seasonYear: 2026,
  amountAwardedUsd: 2000,
  outreachByKind: [{ kind: "grant_followup", count: 2 }],
};

describe("buildGrantReportSections spend honesty", () => {
  it("discloses missing spend linkage and labels season spend as org-wide context, not grant spend", () => {
    const sections = buildGrantReportSections({
      ...BASE,
      spendByCategory: [
        { category: "Robot parts", totalUsd: 800, count: 2 },
        { category: "Travel", totalUsd: 200, count: 1 },
      ],
    });

    const spend = sections.find((section) => section.id === "spend");
    expect(spend).toBeDefined();
    expect(spend?.title).toBe("Season spending context (not grant-attributed)");
    expect(spend?.body).toContain("Spend linkage is not configured");
    expect(spend?.body).toContain("cannot be reported");
    expect(spend?.body).toContain("For context only");
    expect(spend?.body).toContain("$1,000");
    expect(spend?.body).toContain("across all funding sources");
    // Never claim the org-wide number is this grant's fund usage.
    expect(spend?.body).not.toContain("fund usage");
  });

  it("stays honest when no season expenses are recorded at all", () => {
    const sections = buildGrantReportSections({ ...BASE, spendByCategory: [] });

    const spend = sections.find((section) => section.id === "spend");
    expect(spend?.title).toBe("Season spending context (not grant-attributed)");
    expect(spend?.body).toContain("Spend linkage is not configured");
    expect(spend?.body).toContain("No expense transactions have been recorded");
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
});
