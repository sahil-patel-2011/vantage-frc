import { describe, expect, it } from "vitest";
import {
  contributionRowUsd,
  formatSponsorUsd,
  parseContributionUsd,
  sponsorPageTotals,
  teamContributionTotalUsd,
  totalsBySponsorId,
} from "./totals";

describe("parseContributionUsd", () => {
  it("treats missing and invalid values as 0 — never NaN", () => {
    expect(parseContributionUsd(null)).toBe(0);
    expect(parseContributionUsd(undefined)).toBe(0);
    expect(parseContributionUsd("")).toBe(0);
    expect(parseContributionUsd("nope")).toBe(0);
    expect(parseContributionUsd(Number.NaN)).toBe(0);
  });

  it("parses postgres numeric strings", () => {
    expect(parseContributionUsd("1500.50")).toBe(1500.5);
    expect(parseContributionUsd(250)).toBe(250);
  });
});

describe("contributionRowUsd", () => {
  it("uses cash amount and in-kind / discount estimate", () => {
    expect(contributionRowUsd({ type: "cash", amountUsd: "500", estimatedValueUsd: "99" })).toBe(500);
    expect(contributionRowUsd({ type: "in_kind", amountUsd: null, estimatedValueUsd: "150" })).toBe(150);
    expect(contributionRowUsd({ type: "discount", amountUsd: "40", estimatedValueUsd: null })).toBe(40);
  });
});

describe("sponsor + team totals from contribution rows", () => {
  it("returns $0 when there are no contribution rows and invents no DEMO sponsors", () => {
    expect(teamContributionTotalUsd([])).toBe(0);
    expect(totalsBySponsorId([])).toEqual({});
    expect(formatSponsorUsd(0)).toBe("$0");
    const empty = sponsorPageTotals([], [], true);
    expect(empty.teamTotalUsd).toBe(0);
    expect(empty.amountBySponsorId).toEqual({});
    expect(JSON.stringify(empty)).not.toMatch(/DEMO/i);
  });

  it("sums real rows per sponsor and for the team", () => {
    const rows = [
      { sponsorId: "a", type: "cash" as const, amountUsd: "500" },
      { sponsorId: "a", type: "in_kind" as const, estimatedValueUsd: "100" },
      { sponsorId: "b", type: "cash" as const, amountUsd: 250 },
    ];
    expect(totalsBySponsorId(rows)).toEqual({ a: 600, b: 250 });
    expect(teamContributionTotalUsd(rows)).toBe(850);
    const page = sponsorPageTotals(
      [
        { id: "a", lifetimeContributionUsd: "999" },
        { id: "b", lifetimeContributionUsd: "0" },
        { id: "c", lifetimeContributionUsd: "50" },
      ],
      rows,
      true,
    );
    expect(page.teamTotalUsd).toBe(850);
    expect(page.amountBySponsorId).toEqual({ a: 600, b: 250, c: 0 });
  });

  it("falls back to lifetime fields only before contribution rows load", () => {
    const page = sponsorPageTotals([{ id: "a", lifetimeContributionUsd: "120.25" }], [], false);
    expect(page.teamTotalUsd).toBe(120.25);
    expect(page.amountBySponsorId.a).toBe(120.25);
  });

  it("is $0 for a listed sponsor with zero contribution rows once loaded", () => {
    const page = sponsorPageTotals([{ id: "a", lifetimeContributionUsd: "999" }], [], true);
    expect(page.teamTotalUsd).toBe(0);
    expect(page.amountBySponsorId.a).toBe(0);
    expect(formatSponsorUsd(page.teamTotalUsd)).toBe("$0");
  });
});
