import { expect, test } from "@playwright/test";
import { gotoAsTeam } from "./active-org";
import { clearMilestones } from "./calendar-cleanup";
import { signInAs } from "./session";

/**
 * A build season is mostly the same evening over and over, and the calendar
 * could only be told about one evening at a time — forty practices meant forty
 * trips through the form.
 *
 * The bug these pin was found by running it rather than reading it: the client
 * correctly left the Monday start date out of a Tue/Thu series, and the server
 * added it back, so eight practices became nine and one of them was on a day
 * nobody chose.
 */
test.beforeEach(async ({ context }) => {
  test.skip(!(await signInAs(context, "owner")), "no owner fixture on this box");
});

async function openCalendar(page: import("@playwright/test").Page) {
  // As the team: /calendar resolves an org for itself, but the assertions
  // below read the API directly and need the org in the URL to do it.
  await gotoAsTeam(page, "/calendar");
  await expect(page.locator(".cal-repeat")).toBeVisible({ timeout: 20_000 });
}

test("says how many entries it is about to create, before creating them", async ({ page }) => {
  await openCalendar(page);

  // Nothing chosen: a single entry, and the button says so.
  await expect(page.locator(".cal-repeat-summary")).toContainText(/Once|Pick a start date/);

  await page.getByPlaceholder("e.g. Week 2 scrimmage").fill("Preview only");
  await page.locator('.cal-add input[type="date"]').first().fill("2027-01-04");
  await page.locator('.cal-repeat-days button[aria-label="Tue"]').click();

  // Days chosen but no end date is an unfinished thought, not an error.
  await expect(page.locator(".cal-repeat-summary")).toContainText("Pick a date to repeat until");

  await page.locator('.cal-repeat-range input[type="date"]').fill("2027-02-01");
  await expect(page.locator(".cal-repeat-summary")).toContainText("4 entries — Tue");
  // "Add 4 entries" is a different decision from "Add milestone", and the
  // button has to be the one you are actually making.
  await expect(page.getByRole("button", { name: "Add 4 entries" })).toBeVisible();
});

test("creates a practice schedule on exactly the days chosen", async ({ page }) => {
  await openCalendar(page);

  const title = `Spec practice ${Date.now()}`;
  await page.getByPlaceholder("e.g. Week 2 scrimmage").fill(title);
  // A Monday, deliberately: the series is Tuesdays and Thursdays, so the day
  // the form was filled in on must not become a practice.
  await page.locator('.cal-add input[type="date"]').first().fill("2027-01-04");
  await page.locator('.cal-repeat-days button[aria-label="Tue"]').click();
  await page.locator('.cal-repeat-days button[aria-label="Thu"]').click();
  await page.locator('.cal-repeat-range input[type="date"]').fill("2027-02-01");
  await expect(page.getByRole("button", { name: "Add 8 entries" })).toBeVisible();
  await page.getByRole("button", { name: "Add 8 entries" }).click();

  const created = await page.waitForFunction(
    async (needle) => {
      const response = await fetch(
        `/api/calendar?orgId=${new URLSearchParams(location.search).get("orgId") ?? ""}`,
        { cache: "no-store" },
      );
      if (!response.ok) return null;
      const body = (await response.json()) as { milestones?: { title: string; startsOn: string }[] };
      const rows = (body.milestones ?? []).filter((row) => row.title === needle);
      return rows.length ? rows.map((row) => row.startsOn).sort() : null;
    },
    title,
    { timeout: 25_000 },
  );
  const dates = (await created.jsonValue()) as string[];

  expect(dates).toHaveLength(8);
  // Tuesday is 2 and Thursday is 4. A Monday in here is the bug.
  const weekdays = new Set(dates.map((date) => new Date(`${date}T00:00:00Z`).getUTCDay()));
  expect([...weekdays].sort()).toEqual([2, 4]);
  expect(dates[0]).toBe("2027-01-05");
  expect(dates[dates.length - 1]).toBe("2027-01-28");
});

test("the schedule shows up on the grid it was added to", async ({ page }) => {
  await openCalendar(page);
  await clearMilestones(page, "Grid practice ");
  await page.reload();
  await expect(page.locator(".cal-repeat")).toBeVisible({ timeout: 20_000 });

  const title = `Grid practice ${Date.now()}`;
  await page.getByPlaceholder("e.g. Week 2 scrimmage").fill(title);
  await page.locator('.cal-add input[type="date"]').first().fill("2027-03-01");
  await page.locator('.cal-repeat-days button[aria-label="Wed"]').click();
  await page.locator('.cal-repeat-range input[type="date"]').fill("2027-03-31");
  await page.getByRole("button", { name: /Add \d+ entries/ }).click();
  await page.waitForTimeout(3000);

  // Walk the grid to March 2027 and count the chips.
  const heading = page.locator(".cal-grid-move h2");
  for (let hop = 0; hop < 24; hop += 1) {
    if ((await heading.innerText()).trim() === "March 2027") break;
    await page.getByRole("button", { name: /^Next month/ }).click();
  }
  await expect(heading).toHaveText("March 2027");
  await expect(page.locator(".cal-grid").getByText(title, { exact: true }).first()).toBeVisible({
    timeout: 15_000,
  });
  // Five Wednesdays in March 2027.
  await expect(page.locator(".cal-grid").getByText(title, { exact: true })).toHaveCount(5);

  // And leave the month as it was found, so the next run starts from three
  // free chip slots rather than from this run's five.
  await clearMilestones(page, "Grid practice ");
});
