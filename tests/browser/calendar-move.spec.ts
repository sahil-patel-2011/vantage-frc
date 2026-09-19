import { expect, test } from "@playwright/test";
import { gotoAsTeam } from "./active-org";
import { clearMilestones } from "./calendar-cleanup";
import { signInAs } from "./session";

/**
 * "The scrimmage moved to the following weekend."
 *
 * On this calendar that meant finding the entry in the list below the grid,
 * opening its editor, changing a date field, and — if it ran more than one
 * day — remembering to change the second one by the same amount. Four steps
 * and one of them easy to forget, for the most ordinary thing anybody does to
 * a calendar.
 *
 * Two ways to do it now, and both are tested, because a drag-only feature is
 * a feature half the keyboard cannot reach.
 */
test.beforeEach(async ({ context }) => {
  test.skip(!(await signInAs(context, "owner")), "no owner fixture on this box");
});

async function openCalendar(page: import("@playwright/test").Page) {
  await gotoAsTeam(page, "/calendar");
  await expect(page.locator(".cal-grid-week").first()).toBeVisible({ timeout: 20_000 });
  // Every test here drops an entry on the same handful of days. Without this
  // the third run finds those days already holding three chips and the entry
  // it just made is correct and behind "N more".
  await clearMilestones(page, "Move ");
}

/** Creates an entry on a specific day through the API, and returns its id. */
async function seed(page: import("@playwright/test").Page, title: string, startsOn: string) {
  return page.evaluate(
    async ([name, on]) => {
      const orgId = new URLSearchParams(location.search).get("orgId") ?? "";
      const response = await fetch(`/api/calendar?orgId=${orgId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "add_milestone",
          orgId,
          title: name,
          kind: "event",
          startsOn: on,
          endsOn: null,
          notes: "",
          meetingUrl: null,
        }),
      });
      return response.ok;
    },
    [title, startsOn] as const,
  );
}

/** The stored start date of the one entry with this title. */
async function storedDate(page: import("@playwright/test").Page, title: string) {
  return page.evaluate(async (needle) => {
    const orgId = new URLSearchParams(location.search).get("orgId") ?? "";
    const response = await fetch(`/api/calendar?orgId=${orgId}`, { cache: "no-store" });
    if (!response.ok) return null;
    const body = (await response.json()) as { milestones?: { title: string; startsOn: string }[] };
    return (body.milestones ?? []).find((row) => row.title === needle)?.startsOn ?? null;
  }, title);
}

async function walkTo(page: import("@playwright/test").Page, monthName: string) {
  const heading = page.locator(".cal-grid-move h2");
  for (let hop = 0; hop < 24; hop += 1) {
    if ((await heading.innerText()).trim() === monthName) break;
    await page.getByRole("button", { name: /^Next month/ }).click();
  }
  await expect(heading).toHaveText(monthName);
}

test("an entry can be dragged onto another day", async ({ page }) => {
  await openCalendar(page);
  const title = `Move drag ${Date.now()}`;
  test.skip(!(await seed(page, title, "2027-05-05")), "could not seed");

  await page.reload();
  await walkTo(page, "May 2027");

  const chip = page.locator(`.cal-grid-day[data-date="2027-05-05"] .cal-grid-chip`).filter({
    hasText: title,
  });
  await expect(chip).toBeVisible({ timeout: 15_000 });

  // A real pointer drag: press, travel past the threshold that separates a
  // press from a drag, then release over the target day. `dragTo` would drive
  // HTML5 drag-and-drop, which this grid deliberately does not use — that API
  // does not fire for touch, and a mentor rescheduling a scrimmage is usually
  // holding a phone.
  const from = await chip.boundingBox();
  const to = await page.locator(`.cal-grid-day[data-date="2027-05-12"]`).boundingBox();
  expect(from && to).toBeTruthy();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(from!.x + from!.width / 2 + 20, from!.y + from!.height / 2 + 20, { steps: 5 });
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 10 });
  await page.mouse.up();

  // The grid must agree and so must the database. Only checking the grid
  // would pass on an optimistic update that never landed.
  await expect(
    page.locator(`.cal-grid-day[data-date="2027-05-12"] .cal-grid-chip`).filter({ hasText: title }),
  ).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(() => storedDate(page, title), { timeout: 20_000 })
    .toBe("2027-05-12");
});

test("the arrow keys move a focused entry, a day and a week at a time", async ({ page }) => {
  await openCalendar(page);
  const title = `Move keys ${Date.now()}`;
  test.skip(!(await seed(page, title, "2027-06-09")), "could not seed");

  await page.reload();
  await walkTo(page, "June 2027");

  const chip = page.locator(`.cal-grid-day[data-date="2027-06-09"] .cal-grid-chip`).filter({
    hasText: title,
  });
  await expect(chip).toBeVisible({ timeout: 15_000 });
  await chip.focus();

  await page.keyboard.press("ArrowRight");
  await expect.poll(() => storedDate(page, title), { timeout: 20_000 }).toBe("2027-06-10");

  // Down is a week, which is the shape of the grid and also how a schedule
  // actually slips.
  await page
    .locator(`.cal-grid-day[data-date="2027-06-10"] .cal-grid-chip`)
    .filter({ hasText: title })
    .focus();
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => storedDate(page, title), { timeout: 20_000 }).toBe("2027-06-17");
});

test("with nothing focused the arrows still change the month", async ({ page }) => {
  await openCalendar(page);
  // The entry shortcut must not have eaten the navigation one — they share a
  // key and only the focus tells them apart.
  const heading = page.locator(".cal-grid-move h2");
  const before = (await heading.innerText()).trim();
  await page.locator(".cal-grid-weekdays").click();
  await page.keyboard.press("ArrowRight");
  await expect(heading).not.toHaveText(before);
});

test("a move says so, for somebody who cannot see the grid redraw", async ({ page }) => {
  await openCalendar(page);
  const title = `Move says ${Date.now()}`;
  test.skip(!(await seed(page, title, "2027-07-07")), "could not seed");

  await page.reload();
  await walkTo(page, "July 2027");
  await page
    .locator(`.cal-grid-day[data-date="2027-07-07"] .cal-grid-chip`)
    .filter({ hasText: title })
    .focus();
  await page.keyboard.press("ArrowRight");

  // Its own hook, because the month heading is also a live region — the
  // generic selector matched both and told me nothing about either.
  await expect(page.locator(".cal-grid-said")).toContainText("Moved to", { timeout: 15_000 });
});

test("a press that does not travel is still a press, not a move", async ({ page }) => {
  await openCalendar(page);
  const title = `Move tap ${Date.now()}`;
  test.skip(!(await seed(page, title, "2027-08-04")), "could not seed");

  await page.reload();
  await walkTo(page, "August 2027");

  const chip = page
    .locator(`.cal-grid-day[data-date="2027-08-04"] .cal-grid-chip`)
    .filter({ hasText: title });
  await expect(chip).toBeVisible({ timeout: 15_000 });

  // Without the travel threshold, opening an entry by tapping it becomes a
  // move to wherever the finger settled — the worst kind of bug, because it
  // silently rewrites data in response to a read.
  await chip.click();
  await expect(page.locator(".cal-item.editing, .cal-edit").first()).toBeVisible({
    timeout: 15_000,
  });
  expect(await storedDate(page, title)).toBe("2027-08-04");
});

test("dragging works with a finger, which is how it is used in the pit", async ({ page }) => {
  await openCalendar(page);
  const title = `Move touch ${Date.now()}`;
  test.skip(!(await seed(page, title, "2027-09-08")), "could not seed");

  await page.reload();
  await walkTo(page, "September 2027");

  const chip = page
    .locator(`.cal-grid-day[data-date="2027-09-08"] .cal-grid-chip`)
    .filter({ hasText: title });
  await expect(chip).toBeVisible({ timeout: 15_000 });

  const from = await chip.boundingBox();
  const to = await page.locator(`.cal-grid-day[data-date="2027-09-15"]`).boundingBox();
  expect(from && to).toBeTruthy();

  // A synthesized touch pointer: HTML5 drag-and-drop does not fire for these
  // at all, which is why this grid tracks pointer events instead.
  const client = await page.context().newCDPSession(page);
  const point = (x: number, y: number) => ({ x, y, radiusX: 8, radiusY: 8, force: 1, id: 1 });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [point(from!.x + from!.width / 2, from!.y + from!.height / 2)],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [point(from!.x + from!.width / 2 + 24, from!.y + from!.height / 2 + 24)],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [point(to!.x + to!.width / 2, to!.y + to!.height / 2)],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });

  await expect.poll(() => storedDate(page, title), { timeout: 20_000 }).toBe("2027-09-15");
});
