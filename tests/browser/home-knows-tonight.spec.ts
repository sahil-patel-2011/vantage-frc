import { expect, test } from "@playwright/test";
import { gotoAsTeam } from "./active-org";
import { signInAs } from "./session";

/**
 * Home knows what is on tonight.
 *
 * "What to do now" is the first thing on the first screen, and it could see a
 * match, a duty, an open clock-in and a todo list — everything except the
 * calendar. So on an ordinary Tuesday with a build night at six it said
 * "Nothing you have to do right now", which is not a gap in what it knows but
 * a confidently wrong answer: the data was already loaded, by the
 * `calendar_today` widget, and simply never read.
 *
 * This creates a real event through the team calendar's own API and then
 * checks the card changed. It does not assert the card's exact wording for
 * every state — the other branches have unit tests — only that the calendar
 * is one of the things it can see.
 */
test.beforeEach(async ({ context }) => {
  test.skip(!(await signInAs(context, "owner")), "no owner fixture on this box");
});

const TITLE_PREFIX = "Tonight spec";

/**
 * Make sure nothing outranks the calendar.
 *
 * The card is a priority list: a match starting, a duty, an open clock-in,
 * then the calendar, then todos. Another spec in this suite clocks the owner
 * in and does not clock them out, so this one failed on "You're in the shop"
 * — which is the card being right, and this spec asking its question while
 * the answer was legitimately something else.
 *
 * Clocking out is the precondition, so it is established rather than hoped
 * for. Not clocked in is a fine outcome and not an error.
 */
async function clockOut(page: import("@playwright/test").Page) {
  await page.evaluate(async () => {
    const orgId = new URLSearchParams(location.search).get("orgId") ?? "";
    await fetch(`/api/hours?orgId=${orgId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "clock_out", orgId }),
    }).catch(() => undefined);
  });
}

async function clearProbes(page: import("@playwright/test").Page) {
  await page.evaluate(async (prefix) => {
    const orgId = new URLSearchParams(location.search).get("orgId") ?? "";
    const response = await fetch(`/api/team/calendar?orgId=${orgId}`, { cache: "no-store" });
    if (!response.ok) return;
    const body = (await response.json()) as { events?: Array<{ id: string; title: string }> };
    for (const row of body.events ?? []) {
      if (!row.title.startsWith(prefix)) continue;
      await fetch(`/api/team/calendar?orgId=${orgId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "delete_event", orgId, id: row.id }),
      });
    }
  }, TITLE_PREFIX);
}

test("an event later today shows on the card, and goes when it is removed", async ({ page }) => {
  await gotoAsTeam(page, "/dashboard");
  await expect(page.getByTestId("dash-now")).toBeVisible({ timeout: 25_000 });
  await clockOut(page);
  await clearProbes(page);

  /*
    A match, a scouting duty or a shift outranks the calendar, and those come from
    the seeded event rather than from anything this spec can clear. On a freshly
    seeded CI database the owner's team has matches later today, so the card says
    "You're up next" — correctly. The question this spec asks has no answer then.
  */
  await page.reload();
  await expect(page.getByTestId("dash-now")).not.toContainText("Working out what is next", { timeout: 25_000 });
  const before = (await page.getByTestId("dash-now").innerText()).trim();
  test.skip(
    /You.re up next|You.re scouting next|You.re on duty/i.test(before),
    `something outranks the calendar today: ${before.split("\n")[0]}`,
  );

  /*
    Two hours out, so it is still ahead whenever this runs — and skipped when
    that crosses midnight, because "tonight" then means tomorrow and the card
    is right to ignore it. A spec that quietly redefined its own subject at
    10pm would be worse than one that does not run.
  */
  const start = new Date(Date.now() + 2 * 3_600_000);
  start.setMinutes(0, 0, 0);
  test.skip(start.getDate() !== new Date().getDate(), "two hours from now is tomorrow");

  const title = `${TITLE_PREFIX} ${Date.now()}`;
  const made = await page.evaluate(
    async ([name, startsAt, endsAt]) => {
      const orgId = new URLSearchParams(location.search).get("orgId") ?? "";
      const response = await fetch(`/api/team/calendar?orgId=${orgId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "create_event", orgId, title: name, kind: "meeting", startsAt, endsAt }),
      });
      return response.ok;
    },
    [title, start.toISOString(), new Date(start.getTime() + 3 * 3_600_000).toISOString()] as const,
  );
  test.skip(!made, "the team calendar rejected the event");

  await page.reload();
  const card = page.getByTestId("dash-now");
  await expect(card).toContainText(title, { timeout: 25_000 });
  // The time is the useful half — "there is a thing today" is not actionable.
  await expect(card).toContainText(/Today at \d/);
  await expect(card.getByRole("link", { name: "Open Calendar" })).toBeVisible();

  await clearProbes(page);
  await page.reload();
  await expect(card).not.toContainText(title, { timeout: 25_000 });
});

test("the card does not reach past today to find something to say", async ({ page }) => {
  await gotoAsTeam(page, "/dashboard");
  await expect(page.getByTestId("dash-now")).toBeVisible({ timeout: 25_000 });
  await clearProbes(page);

  // Three days out. The widget behind this loads a whole week, so without a
  // filter the card would announce Thursday's practice as if it were tonight.
  const start = new Date(Date.now() + 3 * 24 * 3_600_000);
  start.setHours(18, 0, 0, 0);
  const title = `${TITLE_PREFIX} later ${Date.now()}`;
  const made = await page.evaluate(
    async ([name, startsAt, endsAt]) => {
      const orgId = new URLSearchParams(location.search).get("orgId") ?? "";
      const response = await fetch(`/api/team/calendar?orgId=${orgId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "create_event", orgId, title: name, kind: "meeting", startsAt, endsAt }),
      });
      return response.ok;
    },
    [title, start.toISOString(), new Date(start.getTime() + 3 * 3_600_000).toISOString()] as const,
  );
  test.skip(!made, "the team calendar rejected the event");

  await page.reload();
  await expect(page.getByTestId("dash-now")).toBeVisible({ timeout: 25_000 });
  await expect(page.getByTestId("dash-now")).not.toContainText(title);

  await clearProbes(page);
});
