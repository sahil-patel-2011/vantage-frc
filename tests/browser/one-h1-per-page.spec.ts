import { expect, test } from "@playwright/test";
import { gotoAsTeam } from "./active-org";
import { signInAs } from "./session";

/**
 * One visible h1 per page.
 *
 * Found on /chat, which had three. The hub supplies the page's h1 ("AI") and
 * hides the feature's own with `display:none` — correct, and invisible to a
 * screen reader too. But the channel name and the empty-state title were also
 * h1s, and those are visible. So the document outline said one page was three
 * pages, which is exactly the information a heading level exists to carry:
 * somebody navigating by heading lands in the middle of a page believing they
 * have arrived somewhere new.
 *
 * Counting *visible* h1s on purpose. A hub tab that renders a feature written
 * to stand alone will have the feature's own h1 in the markup, suppressed —
 * that is the design, not a defect.
 *
 * The pages here are a cross-section: hub tabs, standalone leaves, and a page
 * that is both.
 */
test.beforeEach(async ({ context }) => {
  test.skip(!(await signInAs(context, "owner")), "no owner fixture on this box");
});

const PAGES = [
  "/chat",
  "/dashboard",
  "/calendar",
  "/scouting",
  "/build",
  "/competition",
  "/team",
  "/business",
  "/match-debrief",
  "/parts-relay",
] as const;

for (const path of PAGES) {
  test(`${path} has exactly one visible h1`, async ({ page }) => {
    await gotoAsTeam(page, path);
    await page.waitForLoadState("networkidle").catch(() => {});
    // Wait for a heading rather than a fixed pause: the hub paints its own
    // title before the feature client mounts, and checking too early would
    // count one h1 on a page that is about to have two.
    await expect(page.locator("h1").first()).toBeAttached({ timeout: 25_000 });
    await page.waitForTimeout(2_000);

    const visible = await page.evaluate(() =>
      [...document.querySelectorAll("h1")]
        .filter((heading) => {
          const box = heading.getBoundingClientRect();
          const style = getComputedStyle(heading);
          return (
            box.width > 0 &&
            box.height > 0 &&
            style.visibility !== "hidden" &&
            style.display !== "none"
          );
        })
        .map((heading) => (heading.textContent ?? "").trim().slice(0, 60)),
    );

    expect(visible, `visible h1s on ${path}: ${JSON.stringify(visible)}`).toHaveLength(1);
  });
}
