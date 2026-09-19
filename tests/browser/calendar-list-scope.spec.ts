import { expect, test } from "@playwright/test";
import { gotoAsTeam } from "./active-org";
import { clearMilestones } from "./calendar-cleanup";
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
  await clearMilestones(page, "Scope spec ");
}

/**
 * Two entries, in this month and the next.
 *
 * These used to read whatever the fixture happened to hold, and passed for as
 * long as it held something. A tidy-up that emptied it turned both of them
 * into failures about the feature, when what had actually changed was the
 * data they were quietly relying on. A spec that needs entries makes them.
 */
async function seedTwoMonths(page: import("@playwright/test").Page, stamp: number) {
  const now = new Date();
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 15);
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 15);
  const iso = (day: Date) =>
    `${day.getFullYear()}-${`${day.getMonth() + 1}`.padStart(2, "0")}-${`${day.getDate()}`.padStart(2, "0")}`;

  for (const [index, day] of [thisMonth, nextMonth].entries()) {
    await page.evaluate(
      async ([title, on]) => {
        const orgId = new URLSearchParams(location.search).get("orgId") ?? "";
        await fetch(`/api/calendar?orgId=${orgId}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "add_milestone",
            orgId,
            title,
            kind: "build",
            startsOn: on,
            endsOn: null,
            notes: "",
            meetingUrl: null,
          }),
        });
      },
      [`Scope spec ${stamp}-${index}`, iso(day)] as const,
    );
  }
  await page.reload();
  await expect(page.locator(".cal-list-scope")).toBeVisible({ timeout: 20_000 });
}

test("the list is about the month the grid is showing", async ({ page }) => {
  await openCalendar(page);
  await seedTwoMonths(page, Date.now());
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
  await seedTwoMonths(page, Date.now());

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

  await clearMilestones(page, "Scope spec ");
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
