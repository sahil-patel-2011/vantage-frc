import { describe, expect, it } from "vitest";
import { daysSinceLastContact, isLapsed, needsFollowUp, summarizeContributions } from "./sponsors";

describe("sponsor contribution totals", () => {
  it("splits cash from in-kind estimated value", () => {
    const totals = summarizeContributions([
      { type: "cash", amountUsd: 500, estimatedValueUsd: null, seasonYear: 2026 },
      { type: "in_kind", amountUsd: null, estimatedValueUsd: 150, seasonYear: 2026 },
    ]);
    expect(totals.cashUsd).toBe(500);
    expect(totals.inKindEstimateUsd).toBe(150);
    expect(totals.totalUsd).toBe(650);
  });

  it("scopes totals to a single season when requested", () => {
    const totals = summarizeContributions(
      [
        { type: "cash", amountUsd: 500, estimatedValueUsd: null, seasonYear: 2025 },
        { type: "cash", amountUsd: 300, estimatedValueUsd: null, seasonYear: 2026 },
      ],
      2026,
    );
    expect(totals.cashUsd).toBe(300);
  });
});

describe("relationship freshness", () => {
  it("flags a sponsor with no logged interaction as needing follow-up", () => {
    expect(needsFollowUp(null)).toBe(true);
  });

  it("computes days since last contact", () => {
    const now = new Date("2026-07-17T00:00:00Z");
    expect(daysSinceLastContact("2026-06-17T00:00:00Z", now)).toBe(30);
  });

  it("does not flag a recently-contacted sponsor", () => {
    const now = new Date("2026-07-17T00:00:00Z");
    expect(needsFollowUp("2026-07-10T00:00:00Z", 60, now)).toBe(false);
  });
});

describe("lapsed sponsor detection", () => {
  it("flags sponsors who have not contributed this season", () => {
    expect(isLapsed([2024, 2025], 2026)).toBe(true);
    expect(isLapsed([2026], 2026)).toBe(false);
  });

  it("does not flag a brand-new prospect with no contribution history", () => {
    expect(isLapsed([], 2026)).toBe(false);
  });
});
