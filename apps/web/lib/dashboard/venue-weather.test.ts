import { describe, expect, it } from "vitest";
import {
  venueCoordsFromGeocode,
  venueForecastFromResponse,
  venueForecastUrl,
  venueGeocodeUrl,
  weatherSummaryForCode,
} from "./venue-weather";

describe("venue weather URLs", () => {
  it("builds the Open-Meteo geocode URL with an optional country", () => {
    expect(venueGeocodeUrl("Houston")).toBe(
      "https://geocoding-api.open-meteo.com/v1/search?name=Houston&count=1",
    );
    expect(venueGeocodeUrl("Houston", "USA")).toBe(
      "https://geocoding-api.open-meteo.com/v1/search?name=Houston&count=1&country=USA",
    );
  });

  it("builds the Open-Meteo current forecast URL", () => {
    expect(venueForecastUrl(29.7604, -95.3698)).toBe(
      "https://api.open-meteo.com/v1/forecast?latitude=29.7604&longitude=-95.3698&current=temperature_2m%2Cweather_code",
    );
  });

  it("maps known WMO codes and falls back without inventing a condition", () => {
    expect(weatherSummaryForCode(0)).toBe("Clear");
    expect(weatherSummaryForCode(95)).toBe("Thunderstorm");
    expect(weatherSummaryForCode(12)).toBe("Weather");
    expect(weatherSummaryForCode(undefined)).toBe("Weather");
  });

  it("reads the first geocode hit and ignores a missing or non-numeric result", () => {
    expect(
      venueCoordsFromGeocode({ results: [{ latitude: 29.76, longitude: -95.37 }] }),
    ).toEqual({ latitude: 29.76, longitude: -95.37 });
    expect(venueCoordsFromGeocode({ results: [] })).toBeNull();
    expect(venueCoordsFromGeocode({})).toBeNull();
    expect(venueCoordsFromGeocode({ results: [{ latitude: "29", longitude: -95 }] })).toBeNull();
  });

  it("rounds a live temperature and refuses a forecast without one", () => {
    expect(
      venueForecastFromResponse({ current: { temperature_2m: 31.6, weather_code: 2 } }),
    ).toEqual({ tempC: 32, summary: "Partly cloudy" });
    expect(venueForecastFromResponse({ current: { weather_code: 0 } })).toBeNull();
    expect(venueForecastFromResponse({})).toBeNull();
  });
});
