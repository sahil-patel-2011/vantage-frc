import { expect, test } from "@playwright/test";
import { expectHubReadyOrGate, loadFailureHeading } from "./hub-org-gate";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

const SURFACES = [
  {
    path: "/cross-domain-alerts",
    heading: "Cross-domain alerts",
    crumb: "Build / Cross-domain alerts",
    ready: "Log a subsystem change",
  },
  {
    path: "/decision-critic",
    heading: "Decision critic",
    crumb: "Build / Decision critic",
    ready: "Get a second opinion",
  },
  {
    path: "/season-rollover",
    crumb: "Team / Season rollover",
    heading: "Season rollover",
    ready: "Start a new rollover",
  },
  {
    path: "/object-chat-bridge",
    crumb: "Team / Object chat",
    heading: "Object chat",
    ready: "Link a thread",
  },
] as const;

for (const surface of SURFACES) {
  test(`${surface.path} loads without engineering copy`, async ({ page }) => {
    await page.goto(surface.path);
    const main = page.locator("#main-content");
    await expect(main.getByRole("heading", { level: 1 })).toHaveText(surface.heading);
    await expect(main.locator(".breadcrumbs")).toHaveText(surface.crumb);
    await expect(page.locator("body")).not.toContainText("Application error");
    await expect(page.getByText("vantage-cad")).toHaveCount(0);
    await expect(page.getByText("Onshape OAuth")).toHaveCount(0);

    const ready = main.getByRole("heading", { name: surface.ready, exact: true });
    const setup = main.getByRole("heading", { name: "Choose your team", exact: true });
    const unavailable = loadFailureHeading(page);
    if (!(await expectHubReadyOrGate(page, ready, setup.or(unavailable)))) {
      if (await setup.isVisible()) {
        const choose = main.getByRole("link", { name: "Choose your team" });
        await expect(choose).toHaveCount(1);
        await expect(choose).toHaveAttribute("href", "/workspace");
        await choose.click();
        await expect(page).not.toHaveURL(new RegExp(`${surface.path}$`));
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      }
      return;
    }

    await expect(ready).toBeVisible();
    await expect(page.getByText("vantage-cad")).toHaveCount(0);
    await expect(page.getByText("Onshape OAuth")).toHaveCount(0);
  });
}
