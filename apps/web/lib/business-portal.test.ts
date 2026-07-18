import { describe, expect, it } from "vitest";
import { generateEvidenceDraft, purchaseTotal, rankSponsorFit, sponsorHealth, summarizeBudget } from "./business-portal";

describe("business portal calculations", () => {
  it("keeps requested, committed, and spent money distinct", () => {
    const summary = summarizeBudget({
      totalBudgetCents: 10_000,
      sponsorIncomeCents: 2_000,
      grantIncomeCents: 1_000,
      purchases: [
        { status: "submitted", totalCents: 900 },
        { status: "approved", totalCents: 1_500 },
        { status: "ordered", totalCents: 2_500 },
        { status: "received", totalCents: 1_000 },
        { status: "rejected", totalCents: 5_000 },
      ],
    });
    expect(summary).toEqual({ requestedCents: 900, committedCents: 5_000, spentCents: 3_500, remainingCents: 8_000 });
  });

  it("calculates order total from quantity, unit price, and shipping", () => {
    expect(purchaseTotal({ quantity: 3, unitPriceCents: 1299, shippingCents: 500 })).toBe(4397);
  });

  it("surfaces orders pulse and finance-AI only when the toggle is on", async () => {
    const { buildOrdersPulse } = await import("./orders/business-pulse");
    const purchases = [
      {
        id: "1",
        itemName: "NEO 550",
        vendor: "REV",
        itemUrl: null,
        categoryId: null,
        categoryName: null,
        quantity: 2,
        unitPriceCents: 4500,
        shippingCents: 0,
        totalCents: 9000,
        purpose: "Intake",
        status: "submitted" as const,
        requestedByName: "You",
        requestedAt: "2026-07-01",
        neededBy: null,
        orderedOn: null,
      },
      {
        id: "2",
        itemName: "Belt",
        vendor: "WCP",
        itemUrl: "https://example.com/belt",
        categoryId: null,
        categoryName: null,
        quantity: 1,
        unitPriceCents: 1200,
        shippingCents: 0,
        totalCents: 1200,
        purpose: "Elevator",
        status: "approved" as const,
        requestedByName: "You",
        requestedAt: "2026-07-02",
        neededBy: null,
        orderedOn: null,
      },
    ];
    const off = buildOrdersPulse(purchases, 2026, false);
    expect(off.pendingCount).toBe(1);
    expect(off.readyToBuyCount).toBe(1);
    expect(off.openTotalCents).toBe(10_200);
    expect(off.aiHeadline).toBeNull();
    const on = buildOrdersPulse(purchases, 2026, true);
    expect(on.financeAiEnabled).toBe(true);
    expect(on.aiHeadline).toMatch(/awaiting approval|ready to buy|open/i);
    expect(on.aiRecommendations.length).toBeGreaterThan(0);
  });

  it("flags overdue and stale sponsor relationships", () => {
    const now = new Date("2026-07-17T12:00:00Z");
    expect(sponsorHealth({ status: "active", lastContactOn: "2026-07-01", nextFollowUpOn: "2026-07-10" }, now)).toBe("due");
    expect(sponsorHealth({ status: "active", lastContactOn: "2025-01-01", nextFollowUpOn: null }, now)).toBe("cold");
    expect(sponsorHealth({ status: "active", lastContactOn: "2026-07-01", nextFollowUpOn: null }, now)).toBe("healthy");
  });

  it("ranks source-cited prospects higher when they match robotics and prior industries", () => {
    const result = rankSponsorFit({ text: "A manufacturing company funding youth robotics and STEM education", industries: ["manufacturing"], teamNumber: 1234 });
    expect(result.score).toBeGreaterThanOrEqual(75);
    expect(result.reason).toMatch(/robotics/i);
    expect(result.reason).toMatch(/existing/i);
  });

  it("writes only from recorded evidence and includes its provenance", () => {
    const result = generateEvidenceDraft({
      type: "grant_narrative",
      teamName: "Vantage Robotics",
      teamNumber: 1234,
      audience: "Community Foundation",
      goal: "expand our student machine-shop training",
      seasonYear: 2026,
      impact: { activities: 8, hours: 42, peopleReached: 650 },
      sponsorIncomeCents: 0,
      awards: [{ id: "a1", seasonYear: 2025, awardName: "Engineering Inspiration", eventName: "District Event", awardLevel: null, story: null, sourceUrl: "https://example.org/award" }],
    });
    expect(result.body).toContain("8 community activities");
    expect(result.body).toContain("Engineering Inspiration");
    expect(result.evidence).toHaveLength(2);
    expect(result.evidence[1]?.source).toBe("https://example.org/award");
  });
});
