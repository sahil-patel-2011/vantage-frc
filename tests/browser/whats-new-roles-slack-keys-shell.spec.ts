import { expect, test } from "@playwright/test";
import { expectHubReadyOrGate, loadFailureHeading } from "./hub-org-gate";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

/**
 * `ready` is what the page paints when it has something to show. `empty` is
 * what it paints, correctly, when it does not.
 *
 * /whats-new only grows a "Next actions" block once a release targeting your
 * plan has been published, and on a database where none has it shows an
 * honest empty state instead. Without `empty` here the spec treated a page
 * behaving exactly as designed as a shell regression — a failure that says
 * nothing is worse than no test, because it trains you to skim the list.
 */
const SURFACES = [
  {
    path: "/whats-new",
    heading: "What’s new",
    crumb: "Account / What’s new",
    ready: "Next actions",
    empty: "No releases for your plan yet",
  },
  {
    path: "/doc-roles",
    heading: "Document roles",
    crumb: "Team / Playbook",
    ready: "How this works",
  },
  {
    path: "/team/slack",
    heading: "Slack",
    crumb: "Team / Slack",
    ready: "Connect Slack",
  },
  {
    path: "/team/ai-keys",
    heading: "AI API keys",
    crumb: /AI\s*\/\s*API keys/,
    ready: "Use your own key, just for you",
  },
] as const;

for (const surface of SURFACES) {
  test(`${surface.path} loads without engineering copy`, async ({ page }) => {
    await page.goto(surface.path);
    const main = page.locator("#main-content");
    await expect(main.getByRole("heading", { level: 1 })).toHaveText(surface.heading);
    if (typeof surface.crumb === "string") {
      await expect(main.locator(".breadcrumbs")).toHaveText(surface.crumb);
    } else {
      await expect(main.locator(".breadcrumbs")).toHaveText(surface.crumb);
    }
    await expect(page.locator("body")).not.toContainText("Application error");
    await expect(page.getByText("vantage-cad")).toHaveCount(0);
    await expect(page.getByText("Onshape OAuth")).toHaveCount(0);
    await expect(page.getByText("the database refuses")).toHaveCount(0);
    await expect(page.getByText("Not migrated yet")).toHaveCount(0);

    const shown = "empty" in surface && surface.empty
      ? main
          .getByRole("heading", { name: surface.ready, exact: true })
          .or(main.getByRole("heading", { name: surface.empty as string, exact: true }))
      : main.getByRole("heading", { name: surface.ready, exact: true });
    const ready = shown;
    const setup = main.getByRole("heading", { name: /Choose your team/i });
    const unavailable = loadFailureHeading(page);
    if (!(await expectHubReadyOrGate(page, ready, setup.or(unavailable)))) {
      if (await setup.isVisible()) {
        const choose = main.getByRole("link", { name: "Choose your team" });
        await expect(choose).toHaveCount(1);
        await expect(choose).toHaveAttribute("href", "/workspace");
        await choose.click();
        await expect(page).not.toHaveURL(new RegExp(`${surface.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      }
      return;
    }

    await expect(ready).toBeVisible();
    await expect(page.getByText("vantage-cad")).toHaveCount(0);
    await expect(page.getByText("Onshape OAuth")).toHaveCount(0);
  });
}
