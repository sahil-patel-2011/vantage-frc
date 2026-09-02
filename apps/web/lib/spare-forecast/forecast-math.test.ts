import { describe, expect, it } from "vitest";
import {
  OFFSEASON_HORIZON_DAYS,
  fmeaRate,
  forecastExhaustion,
  observedRate,
  resolveHorizon,
  seasonDaysElapsed,
} from ".";

describe("resolveHorizon", () => {
  it("runs to the end of the next registered event when one is ahead", () => {
    const horizon = resolveHorizon({
      asOf: new Date("2026-03-01T15:00:00Z"),
      nextEventEndsOn: "2026-03-14",
      nextEventName: "Lake Superior Regional",
    });
    expect(horizon).toEqual({
      horizonDays: 13,
      horizonSource: "event",
      horizonEndsOn: "2026-03-14",
      eventName: "Lake Superior Regional",
    });
  });

  it("takes the explicit offseason branch when the event is past or missing", () => {
    const past = resolveHorizon({ asOf: new Date("2026-09-01T00:00:00Z"), nextEventEndsOn: "2026-04-20" });
    expect(past.horizonSource).toBe("offseason");
    expect(past.horizonDays).toBe(OFFSEASON_HORIZON_DAYS);
    expect(past.horizonEndsOn).toBe("2026-11-30");
    const none = resolveHorizon({ asOf: new Date("2026-09-01T00:00:00Z"), nextEventEndsOn: null });
    expect(none.horizonSource).toBe("offseason");
    expect(none.eventName).toBeNull();
  });

  it("never reports a zero-day horizon purely because today is the event's last day", () => {
    const horizon = resolveHorizon({ asOf: new Date("2026-03-14T20:00:00Z"), nextEventEndsOn: "2026-03-14" });
    expect(horizon.horizonSource).toBe("event");
    expect(horizon.horizonDays).toBe(1);
  });
});

describe("rates", () => {
  it("returns null under two ledger movements — one movement is not a rate", () => {
    expect(observedRate({ usedQuantity: 5, eventCount: 1, windowDays: 90 })).toBeNull();
    expect(observedRate({ usedQuantity: 5, eventCount: 0, windowDays: 90 })).toBeNull();
    expect(observedRate({ usedQuantity: 9, eventCount: 3, windowDays: 90 })).toBe(0.1);
  });

  it("derives FMEA cadence from elapsed season days, never dividing by zero", () => {
    expect(fmeaRate({ failureCount: 6, daysElapsed: 0 })).toBe(6);
    expect(fmeaRate({ failureCount: 6, daysElapsed: 60 })).toBe(0.1);
    expect(seasonDaysElapsed(2026, new Date("2026-01-01T00:00:00Z"))).toBe(1);
    expect(seasonDaysElapsed(2026, new Date("2026-03-02T00:00:00Z"))).toBe(60);
  });
});

describe("forecastExhaustion", () => {
  it("prefers the ledger rate and labels it", () => {
    const forecast = forecastExhaustion({
      quantityOnHand: 2,
      observedPerDay: 0.1,
      fmeaPerDay: 0.5,
      horizonDays: 90,
      horizonSource: "offseason",
    });
    expect(forecast.rateSource).toBe("ledger");
    expect(forecast.consumptionPerDay).toBe(0.1);
    expect(forecast.projectedConsumptionRemaining).toBe(9);
    expect(forecast.projectedShortfall).toBe(7);
    expect(forecast.daysUntilExhaustion).toBe(20);
    expect(forecast.willExhaust).toBe(true);
    expect(forecast.urgency).toBe("warning");
    expect(forecast.recommendedOrderQty).toBe(8);
  });

  it("falls back to FMEA cadence when the ledger has no signal", () => {
    const forecast = forecastExhaustion({
      quantityOnHand: 10,
      observedPerDay: null,
      fmeaPerDay: 0.05,
      horizonDays: 30,
      horizonSource: "event",
    });
    expect(forecast.rateSource).toBe("fmea");
    expect(forecast.willExhaust).toBe(false);
    expect(forecast.urgency).toBe("stable");
    expect(forecast.daysUntilExhaustion).toBe(200);
  });

  it("is stable with a labeled source when neither signal exists", () => {
    const forecast = forecastExhaustion({ quantityOnHand: 1, observedPerDay: null, fmeaPerDay: 0, horizonDays: 90, horizonSource: "offseason" });
    expect(forecast.consumptionPerDay).toBe(0);
    expect(forecast.daysUntilExhaustion).toBeNull();
    expect(forecast.urgency).toBe("stable");
  });
});
