import { expect, test } from "@playwright/test";
import { signInAs } from "./session";

/**
 * Live Open-Meteo on a real Better Auth session (`next start` + seeded owner).
 * Skips on the fixture cookie: that Home has no event city, and the fixture
 * is not a session. CI Playwright therefore skips this spec.
 */
test.describe("signed-in venue weather", () => {
  test("event-day Houston card shows a public forecast, not an invented temperature", async ({
    page,
    context,
  }) => {
    const signed = await signInAs(context, "owner");
    test.skip(!signed, "needs a seeded owner (VANTAGE_E2E_OWNER_EMAIL / _PASSWORD)");
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/dashboard");
    await page.waitForLoadState("domcontentloaded");
    await expect(page).not.toHaveURL(/\/signin/);

    const liveTitle = page.getByRole("heading", { name: "Venue weather" });
    const emptyTitle = page.getByRole("heading", { name: "No venue weather" });
    if ((await liveTitle.count()) === 0 && (await emptyTitle.count()) === 0) {
      await page.getByTestId("dash-customize").evaluate((node) => (node as HTMLButtonElement).click());
      await page.getByTestId("dash-open-library").click();
      const weather = page.getByTestId("dash-library-weather_venue");
      await expect(weather).toBeVisible();
      await weather.click();
      await expect(page.getByText(/Venue weather added to the board/i).first()).toBeVisible();
    }

    test.skip(
      (await emptyTitle.count()) > 0 && (await liveTitle.count()) === 0,
      "needs seeded events_ref city + org_active_context on event day",
    );

    await expect(liveTitle).toBeVisible();
    await expect(page.getByText("Houston", { exact: true })).toBeVisible();
    await expect(page.getByText("Loading the public forecast…")).toBeHidden({ timeout: 20_000 });
    await expect(page.getByText(/(\d+°C · |Forecast did not load)/)).toBeVisible();
  });
});
