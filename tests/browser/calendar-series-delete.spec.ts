import { expect, test } from "@playwright/test";
import { gotoAsTeam } from "./active-org";
import { clearMilestones } from "./calendar-cleanup";
import { signInAs } from "./session";

/**
 * Undoing a practice schedule.
 *
 * The repeat control expands "every Tuesday and Thursday until bag day" into
 * real entries rather than storing a rule — right for a team whose Thursdays
 * keep moving, because every entry can then be moved, renamed or cancelled on
 * its own. The cost was that one press made forty entries and it took forty
 * presses to take them back.
 *
 * The rows one press created now share an id, and these check the thing that
 * id is for: the whole schedule goes in one action, and nothing else does.
 */
test.beforeEach(async ({ context, page }) => {
  test.skip(!(await signInAs(context, "owner")), "no owner fixture on this box");
  // Registered before anything clicks. Deleting a schedule asks first, and a
  // click that opens a confirm() does not resolve until something answers it.
  page.on("dialog", (dialog) => void dialog.accept());
});

async function openCalendar(page: import("@playwright/test").Page) {
  await gotoAsTeam(page, "/calendar");
  await expect(page.locator(".cal-repeat")).toBeVisible({ timeout: 20_000 });
  await clearMilestones(page, "Series spec ");
  await clearMilestones(page, "Lone spec ");
}

/**
 * The list under the grid is about the month the grid is about, and these
 * schedules are built in a month nobody is looking at. "Whole season" is the
 * control a person presses for the same reason.
 */
async function showWholeSeason(page: import("@playwright/test").Page) {
  // Waited for rather than fired at: pressing the toggle before the client has
  // hydrated does nothing, and the next assertion then fails on a list that is
  // still showing one month — which reads as the feature being broken.
  const toggle = page.getByRole("button", { name: "Whole season" });
  await expect(toggle.first()).toBeVisible({ timeout: 25_000 });
  await toggle.first().click();
  await expect(page.locator(".cal-list-scope")).toContainText("Whole season", { timeout: 15_000 });
}

/** Every stored entry with this title. */
async function stored(page: import("@playwright/test").Page, title: string) {
  return page.evaluate(async (needle) => {
    const orgId = new URLSearchParams(location.search).get("orgId") ?? "";
    const response = await fetch(`/api/calendar?orgId=${orgId}`, { cache: "no-store" });
    if (!response.ok) return [];
    const body = (await response.json()) as {
      milestones?: { title: string; seriesId?: string | null }[];
    };
    return (body.milestones ?? []).filter((row) => row.title === needle);
  }, title);
}

async function makeSeries(page: import("@playwright/test").Page, title: string) {
  await page.getByPlaceholder("e.g. Week 2 scrimmage").fill(title);
  await page.locator('.cal-add input[type="date"]').first().fill("2027-10-04");
  await page.locator('.cal-repeat-days button[aria-label="Tue"]').click();
  await page.locator('.cal-repeat-range input[type="date"]').fill("2027-11-01");
  await page.getByRole("button", { name: /Add \d+ entries/ }).click();
}

test("one press undoes what one press created", async ({ page }) => {
  await openCalendar(page);

  const title = `Series spec ${Date.now()}`;
  await makeSeries(page, title);

  await expect.poll(async () => (await stored(page, title)).length, { timeout: 25_000 }).toBeGreaterThan(1);
  const rows = await stored(page, title);
  // The entries carry the id, and it is the same one for all of them.
  const ids = new Set(rows.map((row) => row.seriesId));
  expect(ids.size, "the series is not one series").toBe(1);
  expect([...ids][0], "no series id was stored").toBeTruthy();

  await page.reload();
  await showWholeSeason(page);
  const deleteAll = page.getByRole("button", { name: new RegExp(`^Delete all ${rows.length}$`) });
  // The count is on the button, because "Delete series" beside "Delete" is two
  // words that could mean the same thing and only one removes four entries you
  // are not looking at.
  await expect(deleteAll.first()).toBeVisible({ timeout: 20_000 });

  await deleteAll.first().click({ noWaitAfter: true });

  await expect.poll(async () => (await stored(page, title)).length, { timeout: 25_000 }).toBe(0);
});

test("an entry made on its own is not offered a series to delete", async ({ page }) => {
  await openCalendar(page);

  const title = `Lone spec ${Date.now()}`;
  await page.getByPlaceholder("e.g. Week 2 scrimmage").fill(title);
  await page.locator('.cal-add input[type="date"]').first().fill("2027-10-06");
  await page.getByRole("button", { name: /^Add (milestone|1 entry)/ }).click();

  await expect.poll(async () => (await stored(page, title)).length, { timeout: 25_000 }).toBe(1);
  const [row] = await stored(page, title);
  // A series of one is a concept nobody needs, so it is not created.
  expect(row?.seriesId ?? null).toBeNull();

  await page.reload();
  await showWholeSeason(page);
  const item = page.locator(".cal-item").filter({ hasText: title });
  await expect(item.first()).toBeVisible({ timeout: 20_000 });
  await expect(item.first().getByRole("button", { name: /^Delete all/ })).toHaveCount(0);
});

test("deleting one entry of a series leaves the rest", async ({ page }) => {
  await openCalendar(page);

  const title = `Series spec ${Date.now()}`;
  await makeSeries(page, title);
  await expect.poll(async () => (await stored(page, title)).length, { timeout: 25_000 }).toBeGreaterThan(1);
  const before = (await stored(page, title)).length;

  await page.reload();
  await showWholeSeason(page);
  const item = page.locator(".cal-item").filter({ hasText: title }).first();
  await expect(item).toBeVisible({ timeout: 20_000 });

  await item.getByRole("button", { name: "Delete milestone" }).click({ noWaitAfter: true });

  // Plain Delete still means this one. The two buttons sit next to each other
  // and must not do each other's job.
  await expect.poll(async () => (await stored(page, title)).length, { timeout: 25_000 }).toBe(
    before - 1,
  );

  await clearMilestones(page, "Series spec ");
});
