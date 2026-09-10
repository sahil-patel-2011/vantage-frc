import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WeatherVenueLive } from "./extra-cards";

describe("WeatherVenueLive markup", () => {
  it("shows the off-day copy and never a temperature when today is not event day", () => {
    const markup = renderToStaticMarkup(
      createElement(WeatherVenueLive, {
        data: { city: "Houston", name: "Event", isEventDay: false },
      }),
    );
    expect(markup).toContain("Houston");
    expect(markup).toContain("Forecast shows on event day.");
    expect(markup).not.toContain("°C");
  });

  it("shows loading copy on event day before the public forecast returns", () => {
    const markup = renderToStaticMarkup(
      createElement(WeatherVenueLive, { data: { city: "Houston", isEventDay: true } }),
    );
    expect(markup).toContain("Loading the public forecast…");
    expect(markup).not.toContain("°C");
  });
});
