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
