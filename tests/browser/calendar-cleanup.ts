import type { Page } from "@playwright/test";

/**
 * Removes the entries a spec left behind on a previous run.
 *
 * These specs share one database, and a day cell shows three chips before it
 * collapses the rest behind "N more". A spec that adds an entry to the same
 * day every run is therefore fine twice and then starts failing on its own
 * litter — the entry it just created is real, correct, and not on screen.
 *
 * That failure mode is worth naming because it looks exactly like a broken
 * feature, and it arrives long after the change that "caused" it.
 *
 * Called before the work rather than after it: a run that dies half way
 * through still leaves the next one a clean month.
 */
export async function clearMilestones(page: Page, prefix: string): Promise<number> {
  return page.evaluate(async (needle) => {
    const orgId = new URLSearchParams(location.search).get("orgId") ?? "";
    const response = await fetch(`/api/calendar?orgId=${orgId}`, { cache: "no-store" });
    if (!response.ok) return 0;
    const body = (await response.json()) as { milestones?: { id: string; title: string }[] };
    let removed = 0;
    for (const row of body.milestones ?? []) {
      if (!row.title.startsWith(needle)) continue;
      const deleted = await fetch(`/api/calendar?orgId=${orgId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "delete_milestone", orgId, id: row.id }),
      });
      if (deleted.ok) removed += 1;
    }
    return removed;
  }, prefix);
}

/**
 * Clear the same prefixes once the spec is finished with them.
 *
 * `clearMilestones` runs *before* the work on purpose, so a run that dies half
 * way through still hands the next one a clean month. That is the right
 * default and it is not enough on its own: the last run of the day always
 * leaves its rows behind, and they are then real data on a real page. Four of
 * them were sitting on `/calendar` — an "extremely long milestone title", an
 * "Occupied", an "Also" and a "Move touch" — visible to anyone who opened the
 * app, and counted by anything measuring the page.
 *
 * Best-effort and never throwing: a teardown that fails must not turn a
 * passing run red.
 */
export async function clearMilestonesAfter(page: Page, prefixes: readonly string[]): Promise<void> {
  try {
    for (const prefix of prefixes) await clearMilestones(page, prefix);
  } catch {
    // The page may already be closing; the next run clears these anyway.
  }
}

/**
 * The same job for the *team* calendar, whose rows are meetings rather than
 * milestones.
 *
 * The season grid overlays meetings on their day and stops at
 * `MAX_MEETINGS_PER_DAY` (12). `calendar-meetings-overlay.spec.ts` put two
 * meetings on the same two fixed Wednesdays every run and removed neither, so
 * after eighteen runs a newly created meeting was past the cap and simply did
 * not render. The spec then failed claiming the overlay was broken, when the
 * overlay was correctly declining to draw a nineteenth chip in one square.
 *
 * The page must be on a URL carrying `orgId`, which `gotoAsTeam` guarantees.
 */
export async function clearTeamEvents(page: Page, prefixes: readonly string[]): Promise<number> {
  return page.evaluate(async (needles) => {
    const orgId = new URLSearchParams(location.search).get("orgId") ?? "";
    if (!orgId) return 0;
    const response = await fetch(`/api/team/calendar?orgId=${orgId}`, { cache: "no-store" });
    if (!response.ok) return 0;
    const body = (await response.json()) as { events?: { id: string; title: string }[] };
    let removed = 0;
    for (const row of body.events ?? []) {
      if (!needles.some((needle) => row.title.startsWith(needle))) continue;
      const deleted = await fetch(`/api/team/calendar?orgId=${orgId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "delete_event", orgId, id: row.id }),
      });
      if (deleted.ok) removed += 1;
    }
    return removed;
  }, prefixes as readonly string[] as string[]);
}

/** Best-effort teardown twin of `clearTeamEvents`. */
export async function clearTeamEventsAfter(page: Page, prefixes: readonly string[]): Promise<void> {
  try {
    await clearTeamEvents(page, prefixes);
  } catch {
    // The page may already be closing; the next run clears these anyway.
  }
}
