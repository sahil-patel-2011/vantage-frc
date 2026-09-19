import { expect, test } from "@playwright/test";
import { signInAs } from "./session";

/**
 * Calendar had no calendar: a list grouped under month headings. These check
 * the grid is really a grid, that moving around it works, and that the way you
 * add something is pressing the day you mean — there is no Create button to
 * find, because the day is already on screen.
 */
test.beforeEach(async ({ context }) => {
  test.skip(!(await signInAs(context, "owner")), "no owner fixture on this box");
});

type Page = import("@playwright/test").Page;

async function openCalendar(page: Page) {
  await page.goto("/calendar");
  await expect(page.locator(".cal-grid")).toBeVisible({ timeout: 20_000 });
}

/**
 * Move forward to a month this team has nothing in.
 *
 * The specs that add an entry used to work on a fixed cell index in whatever
 * month opened. The suite shares one database and these runs accumulate, so
 * after a few passes that cell held four entries, only three chips render, and
 * the newly added one was behind "1 more" — the test failed while the feature
 * worked. Somewhere empty is somewhere the assertion means what it says.
 */
async function goToEmptyMonth(page: Page) {
  const next = page.getByRole("button", { name: /^Next month/ });
  for (let hop = 0; hop < 24; hop += 1) {
    if ((await page.locator(".cal-grid-chip").count()) === 0) return;
    await next.click();
    await expect(page.locator(".cal-grid-weeks")).toBeVisible();
  }
  throw new Error("no empty month within two years — the fixture has too much data");
}

/** A day inside the open month with nothing on it yet. */
function emptyDay(page: Page, index = 0) {
  return page
    .locator('.cal-grid-day[data-in-month="yes"]')
    .filter({ hasNot: page.locator(".cal-grid-chip") })
    .nth(index);
}

test("the month is seven columns of whole weeks", async ({ page }) => {
  await openCalendar(page);

  await expect(page.locator(".cal-grid-weekdays span")).toHaveCount(7);
  const weeks = page.locator(".cal-grid-week");
  const weekCount = await weeks.count();
  expect(weekCount).toBeGreaterThanOrEqual(4);
  expect(weekCount).toBeLessThanOrEqual(6);

  // Every row is a full week — a short row means the padding logic is wrong
  // and the columns no longer sit under their headings.
  for (let index = 0; index < weekCount; index += 1) {
    await expect(weeks.nth(index).locator(".cal-grid-day")).toHaveCount(7);
  }
});

test("today is marked once, in the month that opens", async ({ page }) => {
  await openCalendar(page);
  await expect(page.locator('.cal-grid-day[data-today="yes"]')).toHaveCount(1);
});

test("the arrows move a month at a time and Today comes back", async ({ page }) => {
  await openCalendar(page);
  const heading = page.locator(".cal-grid-move h2");
  const started = (await heading.innerText()).trim();

  await page.getByRole("button", { name: /^Next month/ }).click();
  await expect(heading).not.toHaveText(started);
  // Away from this month, today's ring is gone and Today appears.
  await expect(page.locator('.cal-grid-day[data-today="yes"]')).toHaveCount(0);

  await page.getByRole("button", { name: "Today" }).click();
  await expect(heading).toHaveText(started);
  // And it takes itself away again, rather than sitting there doing nothing.
  await expect(page.getByRole("button", { name: "Today" })).toHaveCount(0);
});

test("arrow keys and T move around without touching the mouse", async ({ page }) => {
  await openCalendar(page);
  const heading = page.locator(".cal-grid-move h2");
  const started = (await heading.innerText()).trim();

  await page.keyboard.press("ArrowRight");
  await expect(heading).not.toHaveText(started);
  await page.keyboard.press("ArrowLeft");
  await expect(heading).toHaveText(started);

  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("t");
  await expect(heading).toHaveText(started);
});

test("pressing a day is how you add to it", async ({ page }) => {
  await openCalendar(page);

  await goToEmptyMonth(page);
  const day = emptyDay(page, 9);
  const dayNumber = (await day.locator(".cal-grid-num").innerText()).trim();
  await day.locator(".cal-grid-add").click();

  const composer = day.locator(".cal-grid-composer input");
  await expect(composer).toBeVisible();
  await expect(composer).toBeFocused();

  const title = `Grid check ${Date.now()}`;
  await composer.fill(title);
  await composer.press("Enter");

  // It lands on the day that was pressed, and nowhere else.
  await expect(day.getByText(title, { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".cal-grid").getByText(title, { exact: true })).toHaveCount(1);
  expect(dayNumber).not.toBe("");
});

test("escape abandons a new entry, and an empty composer closes itself", async ({ page }) => {
  await openCalendar(page);
  await goToEmptyMonth(page);
  const day = emptyDay(page, 3);

  await day.locator(".cal-grid-add").click();
  await expect(day.locator(".cal-grid-composer input")).toBeVisible();
  await day.locator(".cal-grid-composer input").press("Escape");
  await expect(day.locator(".cal-grid-composer")).toHaveCount(0);

  // Typing nothing and clicking away should not leave a stray composer open.
  await day.locator(".cal-grid-add").click();
  await expect(day.locator(".cal-grid-composer input")).toBeVisible();
  await page.locator(".cal-grid-move h2").click();
  await expect(day.locator(".cal-grid-composer")).toHaveCount(0);
});

test("a day that already has something on it can still be added to", async ({ page }) => {
  await openCalendar(page);

  // The bug this pins: "add here" was an absolutely-positioned overlay across
  // the whole cell, sitting *under* the chips. So the moment a day had an
  // entry on it, the middle of that cell was covered and pressing it did
  // nothing — which is every day you would most want to add a second thing to.
  await goToEmptyMonth(page);
  const day = emptyDay(page, 11);
  const first = `Occupied ${Date.now()}`;
  await day.locator(".cal-grid-add").click();
  await day.locator(".cal-grid-composer input").fill(first);
  await day.locator(".cal-grid-composer input").press("Enter");
  await expect(day.getByText(first, { exact: true })).toBeVisible({ timeout: 20_000 });

  const second = `Also ${Date.now()}`;
  await day.locator(".cal-grid-add").click({ timeout: 10_000 });
  await day.locator(".cal-grid-composer input").fill(second);
  await day.locator(".cal-grid-composer input").press("Enter");
  await expect(day.getByText(second, { exact: true })).toBeVisible({ timeout: 20_000 });

  // Both are on the same day, not one of them somewhere else.
  await expect(day.getByText(first, { exact: true })).toBeVisible();
});
