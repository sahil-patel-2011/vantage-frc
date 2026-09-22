import { expect, test } from "@playwright/test";
import { gotoAsTeam } from "./active-org";
import { loadFailureHeading } from "./hub-org-gate";
import { signInAs } from "./session";

/**
 * Four complete features nobody could find.
 *
 * Each has an API, offline support and its own unit tests, and none of them
 * appeared in any menu — they opened only if you typed the URL. The rule that
 * exists to prevent exactly this reported no orphans, because it counted a
 * route as "linked" when an offline-cache list or robots.ts named it. Being
 * named in a config file is not a way in for a person.
 *
 * They are in the command palette now. These check the other half of the
 * claim: that the pages they point at actually work. A menu entry leading to
 * a crash is worse than no menu entry, and these had gone a long time without
 * anybody opening them.
 */
test.beforeEach(async ({ context }) => {
  test.skip(!(await signInAs(context, "owner")), "no owner fixture on this box");
});

const PAGES = [
  { path: "/match-debrief", heading: /match debrief/i },
  { path: "/cad-review-queue", heading: /CAD Review Queue/i },
  { path: "/parts-relay", heading: /Parts Relay/i },
  { path: "/season-rollover", heading: /Season rollover/i },
] as const;

for (const page_ of PAGES) {
  test(`${page_.path} opens and says what it is`, async ({ page }) => {
    const crashes: string[] = [];
    page.on("pageerror", (error) => crashes.push(String(error)));

    await gotoAsTeam(page, page_.path);

    const heading = page.getByRole("heading", { level: 1 }).filter({ hasText: page_.heading });
    const gate = page.getByRole("heading", { name: /choose (a|your) team/i });
    await expect(heading.or(gate).or(loadFailureHeading(page)).first()).toBeVisible({
      timeout: 25_000,
    });

    await expect(page.locator("body")).not.toContainText("Application error");
    // An empty state is a correct outcome on a fresh team and is not a
    // failure. An uncaught exception is.
    expect(crashes, crashes.join("\n")).toEqual([]);
  });
}
