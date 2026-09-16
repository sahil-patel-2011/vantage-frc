import { expect, test } from "@playwright/test";
import { expectHubReadyOrGate, loadFailureHeading } from "./hub-org-gate";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

let realSession = false;

test.beforeEach(async ({ context }) => {
  realSession = await signInAs(context, "owner");
  if (!realSession) await signInFixture(context);
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
    heading: "Claude Code",
    crumb: "Team / Claude Code",
    ready: "Pair this computer",
    // Redirects to /signin when there is no Better Auth session, and the
    // fixture cookie mints none — the proxy then lands the walk on Home.
    needsRealSession: true,
  },
] as const;

for (const surface of SURFACES) {
  test(`${surface.path} loads without engineering copy`, async ({ page }) => {
    test.skip(
      "needsRealSession" in surface && surface.needsRealSession === true && !realSession,
      `${surface.path} needs a real Better Auth session`,
    );
    await page.goto(surface.path);
    const main = page.locator("#main-content");
    // `next dev` compiles each route on first request, which outruns the
    // default 5s expect. Wait for the shell, then assert with room to spare.
    await waitForLoadingGone(page);
    await expect(main.getByRole("heading", { level: 1 })).toHaveText(surface.heading, {
      timeout: 20_000,
    });
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
