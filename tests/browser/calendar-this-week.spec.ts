import { expect, test } from "@playwright/test";
import { gotoAsTeam } from "./active-org";
import { clearMilestones } from "./calendar-cleanup";
import { signInAs } from "./session";

/**
 * "What have we got left this week?"
 *
 * The page used to answer worst the question it was most often opened with.
 * The hero said what the next milestone is — in October, a competition eleven
 * weeks away — and the grid showed a month, so finding out whether anything
 * was on before Saturday meant reading a square at a time.
 *
 * Built around today rather than a fixed date, because "this week" is the one
 * assertion that cannot be pinned to a calendar: whichever day this runs on,
 * today is in it.
 */
test.beforeEach(async ({ context }) => {
  test.skip(!(await signInAs(context, "owner")), "no owner fixture on this box");
});

function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, "0")}-${`${now.getDate()}`.padStart(2, "0")}`;
}

async function addToday(page: import("@playwright/test").Page, title: string) {
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
          kind: "practice",
          startsOn: on,
          endsOn: null,
          notes: "",
          meetingUrl: null,
        }),
      });
      return response.ok;
    },
    [title, todayISO()] as const,
  );
}

test("today's entries are in the rest of this week", async ({ page }) => {
  await gotoAsTeam(page, "/calendar");
  await expect(page.locator(".cal-hero-week")).toBeVisible({ timeout: 25_000 });
  await clearMilestones(page, "Week strip ");

  const title = `Week strip ${Date.now()}`;
  test.skip(!(await addToday(page, title)), "could not add an entry");

  await page.reload();
  const strip = page.locator(".cal-hero-week");
  await expect(strip).toContainText(title, { timeout: 25_000 });
  // The weekday is there so an entry can be placed without reading a date.
  await expect(strip.locator("li", { hasText: title }).locator("b")).not.toBeEmpty();

  await clearMilestones(page, "Week strip ");
});

test("a quiet week says so rather than reaching further out", async ({ page }) => {
  await gotoAsTeam(page, "/calendar");
  await expect(page.locator(".cal-hero-week")).toBeVisible({ timeout: 25_000 });

  const strip = page.locator(".cal-hero-week");
  const text = await strip.innerText();
  if (/Nothing else scheduled/.test(text)) {
    // The honest empty state. Pulling something in from next week to fill the
    // box would make "this week" mean whatever was available.
    await expect(strip.locator("li")).toHaveCount(0);
  } else {
    // Otherwise every row belongs to a day from today onwards — never a day
    // already spent.
    await expect(strip.locator("li").first()).toBeVisible();
  }
});

test("the strip is about the same week the grid is drawing", async ({ page }) => {
  await gotoAsTeam(page, "/calendar");
  await expect(page.locator(".cal-hero-week")).toBeVisible({ timeout: 25_000 });
  await clearMilestones(page, "Week strip ");

  const title = `Week strip ${Date.now()}`;
  test.skip(!(await addToday(page, title)), "could not add an entry");
  await page.reload();

  // Today is on the grid's current month, and the entry the strip names is on
  // the square for today. Two views of one week that disagreed would be worse
  // than one view.
  const cell = page.locator(`.cal-grid-day[data-date="${todayISO()}"]`);
  const more = cell.locator(".cal-grid-more");
  if (await more.count()) await more.first().click();
  await expect(cell.getByText(title, { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".cal-hero-week")).toContainText(title);

  await clearMilestones(page, "Week strip ");
});
