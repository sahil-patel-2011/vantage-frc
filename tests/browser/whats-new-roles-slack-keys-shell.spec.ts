import { expect, test } from "@playwright/test";
import { expectHubReadyOrGate, loadFailureHeading } from "./hub-org-gate";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

const SURFACES = [
  {
    path: "/whats-new",
    heading: "What’s new",
    crumb: "Account / What’s new",
    ready: "Next actions",
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

    const ready = main.getByRole("heading", { name: surface.ready, exact: true });
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
