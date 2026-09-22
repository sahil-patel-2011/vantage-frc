import { expect, test } from "@playwright/test";
import { gotoAsTeam } from "./active-org";
import { clearMilestones, clearMilestonesAfter } from "./calendar-cleanup";
import { signInAs } from "./session";

/**
 * Seven equal columns, whatever is written in them.
 *
 * The grid asked for `repeat(7,1fr)`, and `1fr` means `minmax(auto,1fr)` — a
 * column will not shrink below the min-content width of what is in it, and
 * the min-content of a chip is its whole untruncated title. `text-overflow:
 * ellipsis` says how to paint an overflow, not how wide the element may be.
 *
 * So one long entry title widened its weekday and squeezed the other six. A
 * week with a build night on Thursday came out with a wide Thursday and four
 * columns too narrow to read, which looked like a rendering fault and was
 * arithmetic.
 *
 * This writes the long title deliberately, because the bug only exists when
 * something is in a cell.
 */
test.beforeEach(async ({ context }) => {
  test.skip(!(await signInAs(context, "owner")), "no owner fixture on this box");
});

test.afterEach(async ({ page }) => {
  await clearMilestonesAfter(page, ["An extremely long milestone title"]);
});

const LONG = "An extremely long milestone title that will not fit in one grid column at all";

async function columnSpreads(page: import("@playwright/test").Page): Promise<number[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll(".cal-grid-week")].map((week) => {
      const widths = [...week.children].map((cell) => cell.getBoundingClientRect().width);
      return Math.max(...widths) - Math.min(...widths);
    }),
  );
}

test("one long title does not squeeze the other six days", async ({ page }) => {
  await gotoAsTeam(page, "/calendar");
  await expect(page.locator(".cal-grid-week").first()).toBeVisible({ timeout: 20_000 });
  // The long title this adds is the widest thing in the database, and every
  // run adds another one. They are the point of the test and not of anything
  // else, so they go when it is done with them.
  await clearMilestones(page, "An extremely long milestone title");

  // A day with nothing on it, so the composer is reachable.
  const empty = page
    .locator('.cal-grid-day[data-in-month="yes"]')
    .filter({ hasNot: page.locator(".cal-grid-chip") })
    .first();
  const date = await empty.getAttribute("data-date");
  expect(date).toBeTruthy();

  await empty.locator(".cal-grid-add").click();
  await page.locator(".cal-grid-composer input").fill(`${LONG} ${Date.now()}`);
  await page.locator(".cal-grid-composer input").press("Enter");

  // The cell has to actually have the chip in it before the widths mean
  // anything — the locator is re-evaluated, so it points at the same date.
  await expect(
    page.locator(`.cal-grid-day[data-date="${date}"] .cal-grid-chip`).first(),
  ).toBeVisible({ timeout: 20_000 });

  // Sub-pixel track rounding is real; anything above a pixel is the bug.
  for (const spread of await columnSpreads(page)) {
    expect(spread).toBeLessThanOrEqual(1);
  }
});

test("the columns stay equal on a phone, where there is no room to lose", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoAsTeam(page, "/calendar");
  await expect(page.locator(".cal-grid-week").first()).toBeVisible({ timeout: 20_000 });

  for (const spread of await columnSpreads(page)) {
    expect(spread).toBeLessThanOrEqual(1);
  }

  // And the weekday headings sit over their own columns rather than over a
  // set of tracks sized differently from the cells below them.
  const headings = await page.evaluate(() =>
    [...document.querySelectorAll(".cal-grid-weekdays span")].map((s) =>
      Math.round(s.getBoundingClientRect().left),
    ),
  );
  const firstWeek = await page.evaluate(() =>
    [...(document.querySelector(".cal-grid-week")?.children ?? [])].map((c) =>
      Math.round(c.getBoundingClientRect().left),
    ),
  );
  expect(headings).toEqual(firstWeek);
});
