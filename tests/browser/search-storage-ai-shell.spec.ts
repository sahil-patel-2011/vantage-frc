import { expect, test } from "@playwright/test";
import { expectHubReadyOrGate, loadFailureHeading } from "./hub-org-gate";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

const SURFACES = [
  {
    path: "/search",
    heading: "Search",
    ready: "Start typing to search",
  },
  {
    path: "/team/storage",
    heading: "Self-hosted storage",
    crumb: "Team / Storage",
    ready: "Pair a node",
  },
  {
    path: "/team/ai-usage",
    heading: "Your keys usage",
    crumb: /AI\s*\/\s*Your keys usage/,
    ready: "No calls with your keys yet",
  },
  {
    path: "/team/ai-bridge",
    heading: "AI subscription bridge",
    crumb: "Team / AI subscription bridge",
    ready: "Pair a machine",
  },
] as const;

for (const surface of SURFACES) {
  test(`${surface.path} loads without engineering copy`, async ({ page }) => {
    await page.goto(surface.path);
    const main = page.locator("#main-content");
    await expect(main.getByRole("heading", { level: 1 })).toHaveText(surface.heading);
    if ("crumb" in surface && surface.crumb) {
      if (typeof surface.crumb === "string") {
        await expect(main.locator(".breadcrumbs")).toHaveText(surface.crumb);
      } else {
        await expect(main.locator(".breadcrumbs")).toHaveText(surface.crumb);
      }
    }
    await expect(page.locator("body")).not.toContainText("Application error");
    await expect(page.getByText("No workspace to search")).toHaveCount(0);
    await expect(page.getByText("docs/STORAGE_NODE.md")).toHaveCount(0);
    await expect(page.getByText("docs/AI_BRIDGE.md")).toHaveCount(0);
    await expect(page.getByText("0486")).toHaveCount(0);
    await expect(page.getByText("node server.mjs")).toHaveCount(0);
    await expect(page.getByText("node bridge.mjs")).toHaveCount(0);

    const ready = main.getByRole("heading", { name: surface.ready, exact: true });
    const setup = main.getByRole("heading", { name: /Choose your team/i });
    const unavailable = loadFailureHeading(page);
    if (!(await expectHubReadyOrGate(page, ready, setup.or(unavailable)))) {
      if (await setup.isVisible()) {
        const choose = main.getByRole("link", { name: "Choose your team" });
        await expect(choose).toHaveCount(1);
        await expect(choose).toHaveAttribute("href", "/workspace");
        await choose.click();
        await expect(page).not.toHaveURL(
          new RegExp(`${surface.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
        );
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      }
      return;
    }

    await expect(ready).toBeVisible();
    await expect(page.getByText("No workspace to search")).toHaveCount(0);
    await expect(page.getByText("docs/AI_BRIDGE.md")).toHaveCount(0);
  });
}
