import { expect, test } from "@playwright/test";
import { signInAs } from "./session";

/**
 * Live Open-Meteo on a real Better Auth session (`next start` + seeded owner).
 * Skips on the fixture cookie: that Home has no event city, and the fixture
 * is not a session. CI Playwright therefore skips this spec.
 */
test.describe("signed-in venue weather", () => {
  test("the venue card shows a public forecast or says why not, never an invented temperature", async ({
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

    /*
      The city is whatever event this team is actually at. Pinning "Houston"
      pinned one seed: on any other database the card was correct, named a
      different city, and the spec called it a failure — which taught nothing
      except to distrust the spec.

      The guarantee worth testing is the one the widget was written for: it
      names the venue it got from the event, and it either shows a real
      reading or says the forecast did not load. It never fills the gap with a
      number.
    */
    const card = page.locator(".dash-widget", { has: liveTitle });
    const city = (await card.locator("strong").first().innerText()).trim();
    test.skip(city.length === 0, "needs a seeded events_ref city on event day");

    // Four states the widget can honestly be in, and no fifth. Off event day
    // it says so rather than fetching a forecast nobody asked for, which the
    // spec used to treat as a failure on every day but one.
    const onEventDay = !(await card.getByText("Forecast shows on event day.").count());
    if (!onEventDay) {
      await expect(card).toContainText("Forecast shows on event day.");
      // The thing that must never happen, on any day: a number with nothing
      // behind it.
      await expect(card).not.toContainText(/\d+°/);
      return;
    }

    await expect(page.getByText("Loading the public forecast…")).toBeHidden({ timeout: 20_000 });
    await expect(card.getByText(/\d+°C · |Forecast did not load/)).toBeVisible();
  });
});
