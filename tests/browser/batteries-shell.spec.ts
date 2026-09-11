import { expect, test } from "@playwright/test";
import { expectHubReadyOrGate, loadFailureHeading } from "./hub-org-gate";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Batteries still loads after the panel split", async ({ page }) => {
  await page.goto("/batteries");
  const build = page.getByRole("heading", { level: 1, name: "Build" });
  const standalone = page.getByRole("heading", { level: 1, name: "Batteries" });
  await expect(build.or(standalone)).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Application error");

  const islandTeam = page.getByTestId("soft-island").getByRole("link", { name: "Team", exact: true });
  if (await islandTeam.isVisible()) {
    const href = await islandTeam.getAttribute("href");
    const orgId = href ? new URL(href, page.url()).searchParams.get("orgId") : null;
    if (orgId) {
      await page.goto(`/batteries?orgId=${encodeURIComponent(orgId)}`);
      await expect(page.getByRole("heading", { level: 1, name: /Build|Batteries/ })).toBeVisible();
    }
  }

  const add = page.getByRole("heading", { name: "Add a battery", exact: true });
  const setup = page.getByRole("heading", { name: "Choose your team", exact: true });
  const unavailable = loadFailureHeading(page);
  if (!(await expectHubReadyOrGate(page, add, setup.or(unavailable)))) {
    await page.screenshot({ path: "/opt/cursor/artifacts/batteries-after-split.png", fullPage: true });
    return;
  }

  if (await setup.isVisible()) {
    await expect(page.getByRole("heading", { name: "Next actions" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Choose your team" })).toHaveCount(1);
    await page.screenshot({ path: "/opt/cursor/artifacts/batteries-after-split.png", fullPage: true });
    return;
  }

  await expect(page.getByRole("heading", { name: "Add a battery" })).toBeVisible();
  await page.screenshot({ path: "/opt/cursor/artifacts/batteries-after-split.png", fullPage: true });
});
