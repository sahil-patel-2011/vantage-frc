import { expect, test } from "@playwright/test";
import { gotoAsTeam } from "./active-org";
import { signInAs } from "./session";

/**
 * The calendar says when you are putting two things in the same hour.
 *
 * It used to accept a 6pm build night on a Tuesday that already had a 6pm
 * all-hands, save it without a word, and leave the team to discover the clash
 * on Tuesday. Both rows are legitimate, which is why nobody caught it.
 *
 * The unit tests cover which pairs count as a conflict. This covers the part
 * they cannot: that the warning is actually rendered, that it reacts to the
 * time field rather than only to a save, and — the half that matters more —
 * that it stays quiet when there is nothing to warn about. A warning that is
 * always on is the same as no warning.
 */
test.beforeEach(async ({ context }) => {
  test.skip(!(await signInAs(context, "owner")), "no owner fixture on this box");
});

const PREFIX = "Conflict spec";
const NOTE = ".tc-conflict";

/** A fixed hour well clear of anything else the suite seeds. */
function slot(hour: number): { iso: string; local: string } {
  const day = new Date();
  day.setDate(day.getDate() + 6);
  day.setHours(hour, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    iso: day.toISOString(),
    local: `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}T${pad(hour)}:00`,
  };
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
  }, PREFIX);
}

async function createEvent(
  page: import("@playwright/test").Page,
  title: string,
  startsAt: string,
  endsAt: string,
): Promise<boolean> {
  return page.evaluate(
    async ([name, start, end]) => {
      const orgId = new URLSearchParams(location.search).get("orgId") ?? "";
      const response = await fetch(`/api/team/calendar?orgId=${orgId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "create_event",
          orgId,
          title: name,
          kind: "meeting",
          startsAt: start,
          endsAt: end,
        }),
      });
      return response.ok;
    },
    [title, startsAt, endsAt] as const,
  );
}

test("the quick-add form names the event it would land on, and clears when moved", async ({ page }) => {
  await gotoAsTeam(page, "/team/calendar");
  await clearProbes(page);

  const busy = slot(18);
  const free = slot(6);
  const title = `${PREFIX} all-hands ${Date.now()}`;
  const made = await createEvent(page, title, busy.iso, slot(21).iso);
  test.skip(!made, "the team calendar rejected the event");

  await page.reload();
  const form = page.locator("form.tc-quick-add");
  await expect(form).toBeVisible({ timeout: 25_000 });

  // Nothing typed yet, nothing to warn about.
  await expect(form.locator(NOTE)).toHaveCount(0);

  await form.getByLabel("Starts").fill(busy.local);
  const note = form.locator(NOTE);
  await expect(note).toBeVisible({ timeout: 10_000 });
  // It names the thing, because "1 conflict" sends you hunting for what.
  await expect(note).toContainText(title);

  // Move it to a free hour and the warning goes away on its own — no save.
  await form.getByLabel("Starts").fill(free.local);
  await expect(form.locator(NOTE)).toHaveCount(0, { timeout: 10_000 });

  await clearProbes(page);
});

test("moving an existing event onto another one warns too, and not about itself", async ({ page }) => {
  await gotoAsTeam(page, "/team/calendar");
  await clearProbes(page);

  const busy = slot(20);
  const quiet = slot(7);
  const anchor = `${PREFIX} anchor ${Date.now()}`;
  const mover = `${PREFIX} mover ${Date.now()}`;
  const madeAnchor = await createEvent(page, anchor, busy.iso, slot(23).iso);
  const madeMover = await createEvent(page, mover, quiet.iso, slot(8).iso);
  test.skip(!madeAnchor || !madeMover, "the team calendar rejected the events");

  await page.reload();
  // The default view is the timed grid, which draws its own blocks. Event
  // cards — and the inline editor — live in the List view.
  await page.getByRole("button", { name: "List", exact: true }).click();
  const card = page.locator(".tc-event").filter({ hasText: mover }).first();
  await expect(card).toBeVisible({ timeout: 25_000 });
  await card.getByRole("button", { name: "Edit" }).click();

  const editor = card.locator(".tc-occurrence-edit");
  await expect(editor).toBeVisible({ timeout: 10_000 });

  /*
    An event sitting at its own saved time must not report itself. That was the
    first thing to get wrong here: without excluding the row being edited,
    opening an event and changing only its title would accuse it of clashing
    with itself.
  */
  await expect(editor.locator(NOTE)).toHaveCount(0);

  /*
    Changing only the start leaves the old, now-earlier end behind. That is an
    invalid range, not a clash, and the editor says so rather than silently
    refusing to save — which is what it used to do.
  */
  await editor.getByLabel("Starts").fill(busy.local);
  await expect(editor.locator(NOTE)).toContainText(/ends before it starts/i, { timeout: 10_000 });
  await expect(editor.getByRole("button", { name: "Save" })).toBeDisabled();

  /*
    An invalid draft must never trap anyone in the editor. Blocking Save by
    reusing the `busy` flag would also have disabled Cancel, because that flag
    means "a save is in flight" and greys out the whole group — right then,
    wrong here.
  */
  await expect(editor.getByRole("button", { name: "Cancel" })).toBeEnabled();

  await editor.getByLabel("Ends").fill(slot(22).local);
  await expect(editor.locator(NOTE)).toContainText(anchor, { timeout: 10_000 });
  await expect(editor.getByRole("button", { name: "Save" })).toBeEnabled();

  await clearProbes(page);
});

test("a clash is a warning, not a wall — the event still saves", async ({ page }) => {
  await gotoAsTeam(page, "/team/calendar");
  await clearProbes(page);

  const busy = slot(19);
  const existing = `${PREFIX} existing ${Date.now()}`;
  const made = await createEvent(page, existing, busy.iso, slot(22).iso);
  test.skip(!made, "the team calendar rejected the event");

  await page.reload();
  const form = page.locator("form.tc-quick-add");
  await expect(form).toBeVisible({ timeout: 25_000 });

  const overlapping = `${PREFIX} on top ${Date.now()}`;
  await form.getByLabel("Title").fill(overlapping);
  await form.getByLabel("Starts").fill(busy.local);
  /*
    Leave no roll-call behind. This box is on by default, and saving with it
    ticked also writes an attendance event — which `clearProbes` does not
    remove, because it only knows about the calendar. Two runs of this spec
    were enough to push the Team hub's attendance tab out of its empty state
    and break an unrelated spec that asserts the empty-state primary action.
    The roll-call is not what this test is about, so it does not create one.
  */
  await form.getByLabel("Create attendance roll-call").uncheck();
  await expect(form.locator(NOTE)).toBeVisible({ timeout: 10_000 });

  /*
    Teams double-book on purpose — an optional outreach shift during practice
    is a real thing that happens. A calendar that refused to record it would
    just move the schedule into a group chat, so the submit stays enabled and
    the save goes through.
  */
  const submit = form.getByRole("button", { name: "Add event" });
  await expect(submit).toBeEnabled();
  await submit.click();

  await expect(page.locator("body")).toContainText(overlapping, { timeout: 25_000 });

  await clearProbes(page);
});
