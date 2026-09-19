import { expect, test } from "@playwright/test";
import { gotoAsTeam } from "./active-org";
import { signInAs } from "./session";

/**
 * The list under the grid used to be every milestone in the season, every
 * time: eighty rows under a grid that was already showing them, and the "Add
 * milestone" form at the far end of a twelve-thousand-pixel page.
 *
 * It is now about the month the grid is about, so the grid is how you
 * navigate and the list is how you edit. `Whole season` is still there.
 */
test.beforeEach(async ({ context }) => {
  test.skip(!(await signInAs(context, "owner")), "no owner fixture on this box");
});

async function openCalendar(page: import("@playwright/test").Page) {
  await gotoAsTeam(page, "/calendar");
  await expect(page.locator(".cal-grid-move h2")).toBeVisible({ timeout: 20_000 });
}

test("the list is about the month the grid is showing", async ({ page }) => {
  await openCalendar(page);
  const scope = page.locator(".cal-list-scope");
  await expect(scope).toBeVisible({ timeout: 20_000 });

  const heading = (await page.locator(".cal-grid-move h2").innerText()).trim();
  await expect(scope).toContainText(heading);

  // Move the grid; the list has to move with it. Two views of the same data
  // that disagree about which month it is would be worse than one view.
  await page.getByRole("button", { name: /^Next month/ }).click();
  const next = (await page.locator(".cal-grid-move h2").innerText()).trim();
  expect(next).not.toBe(heading);
  await expect(scope).toContainText(next);

  // And only that month's section is rendered.
  await expect(page.locator(".cal-month")).toHaveCount(1);
});

test("the whole season is still one press away, and comes back", async ({ page }) => {
  await openCalendar(page);
  await expect(page.locator(".cal-list-scope")).toBeVisible({ timeout: 20_000 });

  const scoped = await page.evaluate(() => document.body.scrollHeight);

  await page.getByRole("button", { name: "Whole season" }).click();
  await expect(page.locator(".cal-list-scope")).toContainText("Whole season");
  const whole = await page.evaluate(() => document.body.scrollHeight);
  // The point of the change: the default is the short page, and asking for
  // everything is what makes it long.
  expect(whole).toBeGreaterThan(scoped);

  await page.getByRole("button", { name: "Just this month" }).click();
  await expect(page.locator(".cal-list-scope")).toContainText("Showing");
  await expect(page.locator(".cal-month")).toHaveCount(1);
});

test("a month with nothing in it says so instead of showing another month", async ({ page }) => {
  await openCalendar(page);
  await expect(page.locator(".cal-list-scope")).toBeVisible({ timeout: 20_000 });

  // Walk far enough forward that nothing is scheduled there.
  for (let hop = 0; hop < 20; hop += 1) {
    await page.getByRole("button", { name: /^Next month/ }).click();
  }
  const heading = (await page.locator(".cal-grid-move h2").innerText()).trim();
  await expect(page.locator(".cal-list-scope")).toContainText(heading);

  const sections = page.locator(".cal-month");
  if ((await sections.count()) === 0) {
    // The empty state names the month, so it cannot be mistaken for the whole
    // calendar being empty.
    await expect(page.getByText(`Nothing in ${heading}`)).toBeVisible();
  } else {
    await expect(sections).toHaveCount(1);
    await expect(sections.locator("h2")).toContainText(heading);
  }
});
