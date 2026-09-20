import { expect, test } from "@playwright/test";
import { activeOrgId, gotoAsTeam } from "./active-org";
import { signInAs } from "./session";
import { clearTeamEvents, clearTeamEventsAfter } from "./calendar-cleanup";

/**
 * Vantage has two calendars, and for a while only one of them was on the grid.
 *
 * `/calendar` is the shape of the season — kickoff, competitions, bag day —
 * and `/team/calendar` is the fifty meetings a team actually attends. A
 * student who opened "the calendar" to find out whether there was practice on
 * Thursday saw an empty square and concluded there was not.
 *
 * These create a real meeting through the team calendar's own API, then check
 * the season grid draws it: same data, one owner, two places to see it.
 */
test.beforeEach(async ({ context }) => {
  test.skip(!(await signInAs(context, "owner")), "no owner fixture on this box");
});

const OVERLAY_PROBES = ["Overlay spec ", "Overlay link "] as const;

test.afterEach(async ({ page }) => {
  await clearTeamEventsAfter(page, OVERLAY_PROBES);
});

/** A Wednesday well clear of today, so the assertions do not depend on the date. */
function wednesdayAfter(days: number): Date {
  const day = new Date();
  day.setDate(day.getDate() + days);
  day.setDate(day.getDate() + ((3 - day.getDay() + 7) % 7));
  day.setHours(18, 0, 0, 0);
  return day;
}

function localDay(stamp: Date): string {
  const month = `${stamp.getMonth() + 1}`.padStart(2, "0");
  const day = `${stamp.getDate()}`.padStart(2, "0");
  return `${stamp.getFullYear()}-${month}-${day}`;
}

async function createMeeting(
  page: import("@playwright/test").Page,
  orgId: string,
  title: string,
  start: Date,
  hours: number,
): Promise<boolean> {
  const end = new Date(start.getTime() + hours * 3_600_000);
  return page.evaluate(
    async ([org, name, startsAt, endsAt]) => {
      const response = await fetch(`/api/team/calendar?orgId=${encodeURIComponent(org!)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "create_event",
          orgId: org,
          title: name,
          kind: "meeting",
          startsAt,
          endsAt,
        }),
      });
      return response.ok;
    },
    [orgId, title, start.toISOString(), end.toISOString()] as const,
  );
}

/**
 * Opens a day that has collapsed some of what is on it.
 *
 * A cell shows three chips and hides the rest behind "N more", and milestones
 * take those slots before meetings do. Running this spec on its own, the day
 * was empty and the meeting was the only thing on it; running it after the
 * rest of the suite, the same day already held three milestones somebody
 * else's spec had put there and the meeting was real, correct and collapsed.
 *
 * Pressing "N more" is also what a person does, so this is not a workaround
 * so much as the rest of the interaction.
 */
async function expandDay(page: import("@playwright/test").Page, date: string) {
  const more = page.locator(`.cal-grid-day[data-date="${date}"] .cal-grid-more`);
  if (await more.count()) await more.first().click();
}

async function walkTo(page: import("@playwright/test").Page, monthName: string) {
  const heading = page.locator(".cal-grid-move h2");
  await expect(heading).toBeVisible({ timeout: 20_000 });
  for (let hop = 0; hop < 24; hop += 1) {
    if ((await heading.innerText()).trim() === monthName) break;
    await page.getByRole("button", { name: /^Next month/ }).click();
  }
  await expect(heading).toHaveText(monthName);
}

test("a meeting made on the team calendar shows up on the season grid", async ({ page }) => {
  await gotoAsTeam(page, "/calendar");
  const orgId = await activeOrgId(page);
  test.skip(!orgId, "no active org");
  // Before as well as after: a run that dies half way through must not leave
  // the next one a day already at the overlay's twelve-chip cap.
  await clearTeamEvents(page, OVERLAY_PROBES);

  const start = wednesdayAfter(21);
  const title = `Overlay spec ${Date.now()}`;
  test.skip(!(await createMeeting(page, orgId!, title, start, 3)), "team calendar rejected the event");

  // The season calendar has to have actually loaded it, not just rendered
  // something already in the page.
  const served = await page.waitForFunction(
    async (needle) => {
      const response = await fetch(
        `/api/calendar?orgId=${new URLSearchParams(location.search).get("orgId") ?? ""}`,
        { cache: "no-store" },
      );
      if (!response.ok) return null;
      const body = (await response.json()) as { meetings?: { title: string }[] };
      return (body.meetings ?? []).some((row) => row.title === needle) ? true : null;
    },
    title,
    { timeout: 25_000 },
  );
  expect(await served.jsonValue()).toBe(true);

  await page.reload();
  await walkTo(page, start.toLocaleDateString("en-US", { month: "long", year: "numeric" }));

  await expandDay(page, localDay(start));
  const chip = page.locator(".cal-grid-meeting").filter({ hasText: title });
  await expect(chip.first()).toBeVisible({ timeout: 15_000 });
  // On the right square, and carrying the time — a season milestone has no
  // time, so this is what makes a meeting readable as a meeting.
  const cell = page.locator(`.cal-grid-day[data-date="${localDay(start)}"]`);
  await expect(cell.locator(".cal-grid-meeting").filter({ hasText: title })).toHaveCount(1);
  await expect(chip.first().locator(".cal-grid-meeting-time")).toHaveText("6–9 PM");
});

test("pressing a meeting goes to the calendar that owns it", async ({ page }) => {
  await gotoAsTeam(page, "/calendar");
  const orgId = await activeOrgId(page);
  test.skip(!orgId, "no active org");
  // Before as well as after: a run that dies half way through must not leave
  // the next one a day already at the overlay's twelve-chip cap.
  await clearTeamEvents(page, OVERLAY_PROBES);

  const start = wednesdayAfter(35);
  const title = `Overlay link ${Date.now()}`;
  test.skip(!(await createMeeting(page, orgId!, title, start, 2)), "team calendar rejected the event");

  await page.reload();
  await walkTo(page, start.toLocaleDateString("en-US", { month: "long", year: "numeric" }));

  await expandDay(page, localDay(start));
  const chip = page.locator(".cal-grid-meeting").filter({ hasText: title }).first();
  await expect(chip).toBeVisible({ timeout: 15_000 });
  // A link, not a button: it leaves for the calendar that can edit it, and it
  // says so before you press it rather than after. It points at the workbench
  // tab rather than the legacy `/team/calendar`, which only redirects there —
  // that redirect is how this assertion found the stale href.
  await expect(chip).toHaveAttribute("href", /\/team\?.*tab=calendar/);
  await chip.click();
  await page.waitForURL(/\/team\?.*tab=calendar/, { timeout: 20_000 });
});
