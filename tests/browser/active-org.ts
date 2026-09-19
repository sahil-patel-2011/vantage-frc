import type { Page } from "@playwright/test";
import { waitForLoadingGone } from "./ready";

/**
 * Which team the signed-in account is actually in, and how to open a page as
 * that team.
 *
 * Most product routes need an `orgId`. A spec that navigates without one does
 * not fail there — the page renders its "Choose your team" state perfectly
 * well — so the failure lands several assertions later, on a control that only
 * exists once a team is chosen, and reads as a broken feature. Three separate
 * specs were chasing that ghost when I found it.
 *
 * Two earlier attempts at getting the org are worth recording, because both
 * looked right:
 *
 *  - Reading it from the island's "Team" chip. That href is built with
 *    `withOrgHref`, which only appends an org when the *current URL* already
 *    has one — so on /dashboard it is plain `/team` and this returns nothing.
 *  - Asking `isVisible()` the instant the DOM was ready. The island is
 *    rendered by the app shell after hydration, so the honest answer then is
 *    "not yet", which is not the same as "no team".
 *
 * `/api/me` is where the product itself gets this, so it is where these get
 * it.
 */
export async function activeOrgId(page: Page): Promise<string | null> {
  try {
    const me = await page.evaluate(async () => {
      const response = await fetch("/api/me", { cache: "no-store" });
      if (!response.ok) return null;
      return (await response.json()) as { orgId?: string | null };
    });
    const orgId = me?.orgId;
    return typeof orgId === "string" && orgId ? orgId : null;
  } catch {
    // Signed out, or an account on no team. Both are real states, and a
    // caller that cares handles the "Choose your team" screen it will get.
    return null;
  }
}

/**
 * Open `path` as the signed-in account's team.
 *
 * Needs a page that has already loaded something on this origin, because the
 * org is read with a same-origin fetch. Callers land on /dashboard first,
 * which is also what a person does.
 */
export async function gotoAsTeam(page: Page, path: string): Promise<string | null> {
  if (!page.url().startsWith("http")) {
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  }
  const orgId = await activeOrgId(page);
  const url = orgId
    ? `${path}${path.includes("?") ? "&" : "?"}orgId=${encodeURIComponent(orgId)}`
    : path;
  await page.goto(url);
  await waitForLoadingGone(page);
  return orgId;
}
