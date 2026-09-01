import { describe, expect, it } from "vitest";
import {
  SEASON_LENGTH_DAYS,
  draftPurchaseRequestLines,
  forecastExhaustion,
  forecastUrgencyLabel,
  seasonWindow,
  sortForecastLines,
} from ".";
import type { SpareForecastLine } from "./types";

const OFFSEASON = new Date("2026-08-31T16:00:00.000Z");
const MID_SEASON = new Date("2026-03-15T12:00:00.000Z");

function line(overrides: Partial<SpareForecastLine> & { itemId: string }): SpareForecastLine {
  return {
    itemName: overrides.itemId,
    category: "spare",
    subsystem: "Drivetrain",
    quantityOnHand: 1,
    failureCount: 4,
    unitCost: 10,
    forecast: forecastExhaustion({
      quantityOnHand: 1,
      failureCount: 4,
      daysElapsed: 50,
      daysRemaining: 150,
    }),
    ...overrides,
  };
}

describe("seasonWindow", () => {
  it("keeps a remaining-day horizon mid-season", () => {
    const window = seasonWindow(2026, MID_SEASON);
    expect(window.horizon).toBe("in_season");
    expect(window.daysRemaining).toBeGreaterThan(0);
    expect(window.daysElapsed).toBeGreaterThan(0);
    expect((window.daysElapsed ?? 0) + (window.daysRemaining ?? 0)).toBeGreaterThanOrEqual(
      SEASON_LENGTH_DAYS - 1,
    );
    expect((window.daysElapsed ?? 0) + (window.daysRemaining ?? 0)).toBeLessThanOrEqual(
      SEASON_LENGTH_DAYS + 1,
    );
  });

  it("returns null remaining days after the 200-day window instead of clamping to 0", () => {
    const window = seasonWindow(2026, OFFSEASON);
    expect(window.horizon).toBe("offseason");
    expect(window.daysRemaining).toBeNull();
    expect(window.daysElapsed).toBe(SEASON_LENGTH_DAYS);
  });

  it("does not report a closed remaining-day horizon on the real current date via a 0 clamp", () => {
    const now = new Date();
    const window = seasonWindow(now.getUTCFullYear(), now);
    if (window.horizon === "offseason") {
      expect(window.daysRemaining).toBeNull();
    } else {
      expect(window.daysRemaining).toBeGreaterThan(0);
    }
    expect(window.daysRemaining).not.toBe(0);
  });
});

describe("forecastExhaustion", () => {
  it("projects in-season exhaustion from inventory on-hand × logged FMEA cadence", () => {
    const window = seasonWindow(2026, MID_SEASON);
    const forecast = forecastExhaustion({
      quantityOnHand: 1,
      failureCount: 10,
      daysElapsed: window.daysElapsed,
      daysRemaining: window.daysRemaining,
    });
    expect(forecast.horizon).toBe("in_season");
    expect(forecast.consumptionPerDay).toBeGreaterThan(0);
    expect(forecast.willExhaust).toBe(true);
    expect(forecast.urgency).not.toBeNull();
    expect(forecast.urgency).not.toBe("stable");
    expect(forecast.daysRemaining).toBeGreaterThan(0);
  });

  it("reports stable only when in-season stock covers the remaining horizon", () => {
    const forecast = forecastExhaustion({
      quantityOnHand: 100,
      failureCount: 1,
      daysElapsed: 50,
      daysRemaining: 150,
    });
    expect(forecast.horizon).toBe("in_season");
    expect(forecast.willExhaust).toBe(false);
    expect(forecast.urgency).toBe("stable");
    expect(forecast.projectedShortfall).toBe(0);
  });

  it("returns null remaining-season risk in offseason when FMEA failures are logged", () => {
    const window = seasonWindow(2026, OFFSEASON);
    const forecast = forecastExhaustion({
      quantityOnHand: 4,
      failureCount: 12,
      daysElapsed: window.daysElapsed,
      daysRemaining: window.daysRemaining,
    });
    expect(forecast.horizon).toBe("offseason");
    expect(forecast.daysRemaining).toBeNull();
    expect(forecast.projectedConsumptionRemaining).toBeNull();
    expect(forecast.projectedShortfall).toBeNull();
    expect(forecast.willExhaust).toBeNull();
    expect(forecast.urgency).toBeNull();
    expect(forecast.consumptionPerDay).toBeGreaterThan(0);
    expect(forecast.recommendedOrderQty).toBe(0);
  });

  it("does not treat a clamped 0 remaining-day input as no-risk when failures are logged", () => {
    const forecast = forecastExhaustion({
      quantityOnHand: 2,
      failureCount: 8,
      daysElapsed: SEASON_LENGTH_DAYS,
      daysRemaining: 0,
    });
    expect(forecast.horizon).toBe("offseason");
    expect(forecast.willExhaust).toBeNull();
    expect(forecast.urgency).toBeNull();
    expect(forecast.daysRemaining).toBeNull();
    expect(forecast.consumptionPerDay).toBeGreaterThan(0);
  });

  it("does not report no-risk from the 200-day clamp on the real current date when failures are logged", () => {
    const now = new Date();
    const window = seasonWindow(now.getUTCFullYear(), now);
    const forecast = forecastExhaustion({
      quantityOnHand: 1,
      failureCount: 8,
      daysElapsed: window.daysElapsed,
      daysRemaining: window.daysRemaining,
    });
    expect(forecast.consumptionPerDay).toBeGreaterThan(0);
    if (window.horizon === "offseason") {
      expect(forecast.urgency).toBeNull();
      expect(forecast.willExhaust).toBeNull();
      expect(forecast.daysRemaining).toBeNull();
    } else {
      expect(forecast.willExhaust).toBe(true);
      expect(forecast.urgency).not.toBe("stable");
    }
  });

  it("keeps offseason + zero logged failures as stable with no invented cadence", () => {
    const forecast = forecastExhaustion({
      quantityOnHand: 3,
      failureCount: 0,
      daysElapsed: SEASON_LENGTH_DAYS,
      daysRemaining: null,
    });
    expect(forecast.horizon).toBe("offseason");
    expect(forecast.consumptionPerDay).toBe(0);
    expect(forecast.willExhaust).toBeNull();
    expect(forecast.urgency).toBe("stable");
  });
});

describe("draftPurchaseRequestLines + sortForecastLines", () => {
  it("does not draft restock lines from offseason null-risk forecasts", () => {
    const drafted = draftPurchaseRequestLines([
      line({
        itemId: "offseason",
        forecast: forecastExhaustion({
          quantityOnHand: 1,
          failureCount: 10,
          daysElapsed: SEASON_LENGTH_DAYS,
          daysRemaining: null,
        }),
      }),
    ]);
    expect(drafted).toHaveLength(0);
  });

  it("sorts null-horizon lines ahead of stable in-season stock", () => {
    const sorted = sortForecastLines([
      line({
        itemId: "stable",
        quantityOnHand: 100,
        failureCount: 1,
        forecast: forecastExhaustion({
          quantityOnHand: 100,
          failureCount: 1,
          daysElapsed: 50,
          daysRemaining: 150,
        }),
      }),
      line({
        itemId: "offseason",
        forecast: forecastExhaustion({
          quantityOnHand: 1,
          failureCount: 6,
          daysElapsed: SEASON_LENGTH_DAYS,
          daysRemaining: null,
        }),
      }),
    ]);
    expect(sorted.map((entry) => entry.itemId)).toEqual(["offseason", "stable"]);
  });
});

describe("forecastUrgencyLabel", () => {
  it("labels null urgency as no season horizon, not stable", () => {
    expect(forecastUrgencyLabel(null)).toBe("No season horizon");
    expect(forecastUrgencyLabel("stable")).toBe("Stable");
  });
});
