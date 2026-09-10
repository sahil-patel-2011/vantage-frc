import { expect, test } from "@playwright/test";
import { signInFixture } from "./session";

test.describe("Home venue weather", () => {
  test.beforeEach(async ({ context }) => {
    await signInFixture(context);
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
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/dashboard");
    await page.waitForLoadState("domcontentloaded");
    await page.getByTestId("dash-customize").evaluate((node) => (node as HTMLButtonElement).click());
    await page.getByTestId("dash-open-library").click();
    const weather = page.getByTestId("dash-library-weather_venue");
    await expect(weather).toBeVisible();
    await weather.click();
    await expect(page.getByText(/Venue weather added to the board/i).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "No venue weather" })).toBeVisible();
    await expect(page.getByText("Weather appears when an event with a location is active.")).toBeVisible();
    await expect(page.getByText("26°C · Clear")).toHaveCount(0);
  });
});
