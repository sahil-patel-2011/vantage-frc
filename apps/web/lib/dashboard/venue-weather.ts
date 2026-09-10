/**
 * Public Open-Meteo URLs for the Home venue-weather widget.
 *
 * The loader only returns the event city and whether today is event day.
 * Temperature is fetched in the browser from these URLs — never invented in SQL.
 */

export const OPEN_METEO_GEOCODE_ORIGIN = "https://geocoding-api.open-meteo.com";
export const OPEN_METEO_FORECAST_ORIGIN = "https://api.open-meteo.com";

export const WMO_WEATHER_SUMMARY: Record<number, string> = {
  0: "Clear",
  1: "Mostly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  51: "Drizzle",
  61: "Rain",
  71: "Snow",
  80: "Showers",
  95: "Thunderstorm",
};

export type VenueCoords = { latitude: number; longitude: number };

export type VenueForecast = {
  tempC: number;
  summary: string;
};

export function venueGeocodeUrl(city: string, country?: string | null): string {
  const url = new URL(`${OPEN_METEO_GEOCODE_ORIGIN}/v1/search`);
  url.searchParams.set("name", city);
  url.searchParams.set("count", "1");
  if (country) url.searchParams.set("country", country);
  return url.toString();
}

export function venueForecastUrl(latitude: number, longitude: number): string {
  const url = new URL(`${OPEN_METEO_FORECAST_ORIGIN}/v1/forecast`);
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("current", "temperature_2m,weather_code");
  return url.toString();
}

export function weatherSummaryForCode(code: number | undefined): string {
  if (typeof code === "number" && WMO_WEATHER_SUMMARY[code]) return WMO_WEATHER_SUMMARY[code];
  return "Weather";
}

export function venueCoordsFromGeocode(geo: {
  results?: Array<{ latitude?: unknown; longitude?: unknown }>;
}): VenueCoords | null {
  const place = geo.results?.[0];
  if (!place) return null;
  if (typeof place.latitude !== "number" || typeof place.longitude !== "number") return null;
  if (!Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) return null;
  return { latitude: place.latitude, longitude: place.longitude };
}

export function venueForecastFromResponse(wx: {
  current?: { temperature_2m?: unknown; weather_code?: unknown };
}): VenueForecast | null {
  const temp = wx.current?.temperature_2m;
  if (typeof temp !== "number" || !Number.isFinite(temp)) return null;
  const code = wx.current?.weather_code;
  return {
    tempC: Math.round(temp),
    summary: weatherSummaryForCode(typeof code === "number" ? code : undefined),
  };
}

/** Minimal fetch used by the widget so tests can stub Open-Meteo without a browser. */
export type VenueWeatherFetcher = (url: string) => Promise<{ json: () => Promise<unknown> }>;

export async function loadVenueForecast(
  city: string,
  country?: string | null,
  fetchImpl: VenueWeatherFetcher = (url) => fetch(url),
): Promise<VenueForecast | null> {
  const geo = (await (await fetchImpl(venueGeocodeUrl(city, country || null))).json()) as {
    results?: Array<{ latitude?: unknown; longitude?: unknown }>;
  };
  const place = venueCoordsFromGeocode(geo);
  if (!place) return null;
  const wx = (await (await fetchImpl(venueForecastUrl(place.latitude, place.longitude))).json()) as {
    current?: { temperature_2m?: unknown; weather_code?: unknown };
  };
  return venueForecastFromResponse(wx);
}

export type VenueWeatherCopyKind = "forecast" | "failed" | "loading" | "off";

export function venueWeatherCopy(input: {
  isEventDay: boolean;
  forecast: VenueForecast | null;
  failed: boolean;
}): { kind: VenueWeatherCopyKind; text: string } {
  if (input.isEventDay && input.forecast) {
    return { kind: "forecast", text: `${input.forecast.tempC}°C · ${input.forecast.summary}` };
  }
  if (input.isEventDay && input.failed) {
    return {
      kind: "failed",
      text: "Forecast did not load. Check the venue city on the event.",
    };
  }
  if (input.isEventDay) {
    return { kind: "loading", text: "Loading the public forecast…" };
  }
  return { kind: "off", text: "Forecast shows on event day." };
}
