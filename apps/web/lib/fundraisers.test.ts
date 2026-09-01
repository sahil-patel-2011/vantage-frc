import { describe, expect, it } from "vitest";
import {
  attainmentPct,
  hasFundraiserGoalProgress,
  parseFundraiserAction,
  summarizeFundraisers,
  validateFundraiser,
} from "./fundraisers";

describe("attainmentPct", () => {
  it("computes percent of goal and handles no/zero goal", () => {
    expect(attainmentPct(750, 1000)).toBe(75);
    expect(attainmentPct(750, null)).toBeNull();
    expect(attainmentPct(750, 0)).toBeNull();
  });
});

describe("validateFundraiser", () => {
  it("requires a name, valid type, and valid date", () => {
    expect(validateFundraiser({ type: "car_wash", eventDate: "2026-05-01" }).ok).toBe(false);
    expect(validateFundraiser({ name: "Spring wash", type: "nope", eventDate: "2026-05-01" }).ok).toBe(false);
    expect(validateFundraiser({ name: "Spring wash", type: "car_wash", eventDate: "bad" }).ok).toBe(false);
  });
  it("rejects a negative goal", () => {
    expect(validateFundraiser({ name: "Spring wash", type: "car_wash", eventDate: "2026-05-01", goalUsd: -5 }).ok).toBe(false);
  });
  it("accepts a valid event with no goal", () => {
    const result = validateFundraiser({ name: "Spring wash", type: "car_wash", eventDate: "2026-05-01" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.goalUsd).toBeNull();
  });
});

describe("summarizeFundraisers", () => {
  it("totals raised/goal excluding cancelled and reports attainment", () => {
    const summary = summarizeFundraisers([
      { status: "completed", goalUsd: 1000, proceedsUsd: 900 },
      { status: "active", goalUsd: 500, proceedsUsd: 100 },
      { status: "cancelled", goalUsd: 999, proceedsUsd: 0 },
      { status: "planned", goalUsd: null, proceedsUsd: 0 },
    ]);
    expect(summary.totalRaised).toBe(1000);
    expect(summary.totalGoal).toBe(1500);
    expect(summary.attainment).toBe(67);
    expect(summary.accountingStatus).toBe("gross_only");
    expect(summary.totalExpenses).toBeNull();
    expect(summary.netRaised).toBeNull();
    expect(summary.completed).toBe(1);
    expect(summary.active).toBe(1);
    expect(summary.planned).toBe(1);
    expect(hasFundraiserGoalProgress(summary)).toBe(true);
  });

  it("hides progress chrome when nothing is planned or raised — never DEMO $0 tiles", () => {
    const summary = summarizeFundraisers([
      { status: "planned", goalUsd: null, proceedsUsd: 0 },
      { status: "cancelled", goalUsd: 999, proceedsUsd: 50 },
    ]);
    expect(summary.totalRaised).toBe(0);
    expect(summary.totalGoal).toBe(0);
    expect(summary.attainment).toBeNull();
    expect(hasFundraiserGoalProgress(summary)).toBe(false);
  });
});

describe("parseFundraiserAction", () => {
  it("parses create_event with season year", () => {
    const action = parseFundraiserAction({ action: "create_event", orgId: "o1", seasonYear: 2026, name: "Wash", type: "car_wash", eventDate: "2026-05-01" });
    expect(action).toMatchObject({ action: "create_event", type: "car_wash" });
  });
  it("rejects record_proceeds with non-positive amount", () => {
    expect(() => parseFundraiserAction({ action: "record_proceeds", orgId: "o1", id: "e1", amountUsd: 0 })).toThrow();
  });
  it("rejects an invalid status", () => {
    expect(() => parseFundraiserAction({ action: "set_status", orgId: "o1", id: "e1", status: "exploded" })).toThrow(/status/);
  });
  it("rejects an unsupported action", () => {
    expect(() => parseFundraiserAction({ action: "party", orgId: "o1" })).toThrow(/Unsupported/);
  });
});
