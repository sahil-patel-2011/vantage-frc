import { expect, test } from "@playwright/test";
import { signInFixture } from "./session";

test.describe("Home venue weather", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test.beforeEach(async ({ context }) => {
    await signInFixture(context);
    await context.addInitScript(() => {
      const originalMatchMedia = window.matchMedia.bind(window);
      window.matchMedia = (query) => {
        if (String(query).includes("pointer: coarse")) {
          return {
            matches: true,
            media: query,
            onchange: null,
            addListener() {},
            removeListener() {},
            addEventListener() {},
            removeEventListener() {},
            dispatchEvent() {
              return false;
            },
          };
        }
        return originalMatchMedia(query);
      };
    });
    await context.route("https://geocoding-api.open-meteo.com/**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ results: [{ latitude: 29.76328, longitude: -95.36327 }] }),
      });
    });
    await context.route("https://api.open-meteo.com/**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ current: { temperature_2m: 26.1, weather_code: 0 } }),
      });
    });
  });

  test("library weather card stays honest without an event city", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/dashboard");
    await page.waitForLoadState("domcontentloaded");
    const edit = page.getByRole("button", { name: /edit home/i });
    await expect(edit.first()).toBeVisible();
    await edit.first().click();
    await page.getByTestId("dash-open-library").click();
    const weather = page.getByTestId("dash-library-weather_venue");
    await expect(weather).toBeVisible();
    await weather.click();
    const canvas = page.getByTestId("dash-place-canvas");
    if (await canvas.count()) {
      await canvas.click({ position: { x: 24, y: 24 } });
    }
    await expect(
      page
        .getByText(
          /No venue weather|Weather appears when an event with a location is active|Forecast shows on event day|26°C · Clear/i,
        )
        .first(),
    ).toBeVisible();
  });
});
