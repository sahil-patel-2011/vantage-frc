import { expect, test } from "@playwright/test";
import { gotoAsTeam } from "./active-org";
import { signInAs } from "./session";

/**
 * The team's own pages: a safety brief, build standards, a driver guide, the
 * things a team writes down once and hands to next year's students.
 *
 * Every page belongs to one team. That is not a UI rule — `knowledge_pages`
 * is org-scoped and behind RLS, so one team cannot read another's rows even
 * if a request asks for them. What these check is the half above that: the
 * feature works end to end, and the page a team writes is a page *within*
 * the screen rather than a second screen pretending to be one.
 */
test.beforeEach(async ({ context }) => {
  test.skip(!(await signInAs(context, "owner")), "no owner fixture on this box");
});

async function openPlaybook(page: import("@playwright/test").Page) {
  await gotoAsTeam(page, "/team/knowledge");
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 25_000 });
}

test("a team can start its own playbook, and it is about that team", async ({ page }) => {
  await openPlaybook(page);

  const start = page.getByRole("button", { name: "Start season playbook" }).first();
  const existing = page.locator(".kb-document");
  if (await start.isVisible().catch(() => false)) {
    await start.click();
  }
  await expect(existing.first()).toBeVisible({ timeout: 25_000 });

  // The team's own number, from its own row. A shared template that came back
  // with somebody else's number would be the crossover this feature exists to
  // make impossible.
  const orgName = await page.evaluate(async () => {
    const response = await fetch("/api/me", { cache: "no-store" });
    if (!response.ok) return null;
    const body = (await response.json()) as { teamNumber?: number | null };
    return body.teamNumber ?? null;
  });
  if (orgName) {
    await expect(existing.first()).toContainText(String(orgName));
  }
});

test("a page is a page on the screen, not a second screen", async ({ page }) => {
  await openPlaybook(page);
  const start = page.getByRole("button", { name: "Start season playbook" }).first();
  if (await start.isVisible().catch(() => false)) await start.click();
  await expect(page.locator(".kb-document").first()).toBeVisible({ timeout: 25_000 });

  /*
    A page written as `# Team 6925 2026 season playbook` used to render that as
    an h1, inside a hub that already has one — so the outline said the screen
    was two pages and somebody navigating by heading landed mid-document
    believing they had arrived somewhere new.
  */
  const visibleH1s = await page.evaluate(() =>
    [...document.querySelectorAll("h1")]
      .filter((heading) => {
        const box = heading.getBoundingClientRect();
        const style = getComputedStyle(heading);
        return box.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      })
      .map((heading) => (heading.textContent ?? "").trim().slice(0, 60)),
  );
  expect(visibleH1s, `visible h1s: ${JSON.stringify(visibleH1s)}`).toHaveLength(1);

  // The document still has its own structure, one level down.
  await expect(page.locator(".kb-document h2, .kb-document h3").first()).toBeVisible();
});
