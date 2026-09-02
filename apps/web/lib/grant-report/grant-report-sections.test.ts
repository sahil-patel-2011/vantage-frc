import { describe, expect, it } from "vitest";
import { NO_TAGGED_EXPENSES_NOTE, buildGrantReportNarrative, buildGrantReportSections, spendStateFor } from ".";

const BASE = {
  grantName: "NASA Grant",
  funder: "NASA",
  seasonYear: 2026,
  amountAwardedUsd: 2000,
  outreachByKind: [{ kind: "grant_followup", count: 2 }],
};

describe("buildGrantReportSections spend honesty (0504 grant tagging)", () => {
  it("reports only expenses tagged to this grant, by category, with award coverage", () => {
    const sections = buildGrantReportSections({
      ...BASE,
      spendByCategory: [
        { category: "Robot parts", totalUsd: 800, count: 2 },
        { category: "Travel", totalUsd: 200, count: 1 },
      ],
    });

    const spend = sections.find((section) => section.id === "spend");
    expect(spend).toBeDefined();
    expect(spend?.title).toBe("Grant-attributed spending");
    expect(spend?.body).toContain("tagged 3 expense(s)");
    expect(spend?.body).toContain("$1,000");
    expect(spend?.body).toContain("Robot parts: $800 (2 txn)");
    expect(spend?.body).toContain("50% of the $2,000 award");
    // The old org-wide disclaimer must be gone — the number IS this grant's spend now.
    expect(spend?.body).not.toContain("not grant-attributed");
    expect(spend?.body).not.toContain("Spend linkage is not configured");
  });

  it("states explicitly that nothing is tagged yet instead of showing org-wide spend", () => {
    const sections = buildGrantReportSections({ ...BASE, spendByCategory: [] });

    const spend = sections.find((section) => section.id === "spend");
    expect(spend?.title).toBe("Grant-attributed spending");
    expect(spend?.body).toBe(NO_TAGGED_EXPENSES_NOTE);
    expect(spend?.body).toContain("No expenses tagged to this grant yet");
    expect(spend?.body).toContain("never attributed");
  });

  it("keeps the no-tag statement in the assembled narrative", () => {
    const narrative = buildGrantReportNarrative(buildGrantReportSections({ ...BASE, spendByCategory: [] }));
    expect(narrative).toContain("No expenses tagged to this grant yet");
  });

  it("derives the spend state from tagged lines only", () => {
    expect(spendStateFor([])).toBe("no_tagged_expenses");
    expect(spendStateFor([{ category: "x", totalUsd: 0, count: 0 }])).toBe("no_tagged_expenses");
    expect(spendStateFor([{ category: "x", totalUsd: 10, count: 1 }])).toBe("tagged");
  });
});
