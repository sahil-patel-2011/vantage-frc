import { describe, expect, it } from "vitest";
import {
  loadVenueForecast,
  venueCoordsFromGeocode,
  venueForecastFromResponse,
  venueForecastUrl,
  venueGeocodeUrl,
  venueWeatherCopy,
  weatherSummaryForCode,
  type VenueWeatherFetcher,
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
    expect(venueForecastFromResponse({ current: { temperature_2m: 26.1, weather_code: 0 } })).toEqual({
      tempC: 26,
      summary: "Clear",
    });
    expect(venueForecastFromResponse({ current: { weather_code: 0 } })).toBeNull();
    expect(venueForecastFromResponse({})).toBeNull();
  });
});

describe("venue weather copy", () => {
  it("prints the measured forecast only on event day", () => {
    expect(
      venueWeatherCopy({
        isEventDay: true,
        forecast: { tempC: 26, summary: "Clear" },
        failed: false,
      }),
    ).toEqual({ kind: "forecast", text: "26°C · Clear" });
    expect(venueWeatherCopy({ isEventDay: false, forecast: { tempC: 26, summary: "Clear" }, failed: false })).toEqual({
      kind: "off",
      text: "Forecast shows on event day.",
    });
  });

  it("does not invent a temperature while loading or after a failed public fetch", () => {
    expect(venueWeatherCopy({ isEventDay: true, forecast: null, failed: false })).toEqual({
      kind: "loading",
      text: "Loading the public forecast…",
    });
    expect(venueWeatherCopy({ isEventDay: true, forecast: null, failed: true })).toEqual({
      kind: "failed",
      text: "Forecast did not load. Check the venue city on the event.",
    });
  });
});

describe("loadVenueForecast", () => {
  it("reads Houston 26.1 °C / code 0 as 26°C Clear from the same URLs the card builds", async () => {
    const fetchImpl: VenueWeatherFetcher = async (url) => {
      if (url.startsWith("https://geocoding-api.open-meteo.com/")) {
        expect(url).toBe(venueGeocodeUrl("Houston", "USA"));
        return {
          json: async () => ({ results: [{ latitude: 29.76328, longitude: -95.36327 }] }),
        };
      }
      if (url.startsWith("https://api.open-meteo.com/")) {
        expect(url).toBe(venueForecastUrl(29.76328, -95.36327));
        return {
          json: async () => ({ current: { temperature_2m: 26.1, weather_code: 0 } }),
        };
      }
      throw new Error(`unexpected Open-Meteo URL ${url}`);
    };
    await expect(loadVenueForecast("Houston", "USA", fetchImpl)).resolves.toEqual({
      tempC: 26,
      summary: "Clear",
    });
  });

  it("returns null when geocode has no usable coordinates", async () => {
    const fetchImpl: VenueWeatherFetcher = async () => ({ json: async () => ({ results: [] }) });
    await expect(loadVenueForecast("Nowhere", null, fetchImpl)).resolves.toBeNull();
  });
});
