import { expect, test } from "@playwright/test";
import { expectHubReadyOrGate } from "./hub-org-gate";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Print Farm still loads after the panel split", async ({ page }) => {
  await page.goto("/print-farm");
  await expect(page.getByRole("heading", { level: 1, name: "3D Print Farm" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Application error");

  const islandTeam = page.getByTestId("soft-island").getByRole("link", { name: "Team", exact: true });
  if (await islandTeam.isVisible()) {
    const href = await islandTeam.getAttribute("href");
    const orgId = href ? new URL(href, page.url()).searchParams.get("orgId") : null;
    if (orgId) {
      await page.goto(`/print-farm?orgId=${encodeURIComponent(orgId)}`);
      await expect(page.getByRole("heading", { level: 1, name: "3D Print Farm" })).toBeVisible();
    }
  }

  const queue = page.getByRole("heading", { name: "Queue a print", exact: true });
  const setup = page.getByRole("heading", { name: "Select a team", exact: true });
  const unavailable = page.getByRole("heading", { name: /Could not load the Print Farm/i });
  if (!(await expectHubReadyOrGate(page, queue, setup.or(unavailable)))) {
    await expect(page.getByRole("tab")).toHaveCount(0);
    if (await setup.isVisible()) {
      await expect(page.getByRole("link", { name: "Choose your team" })).toHaveCount(1);
    }
    await page.screenshot({ path: "/opt/cursor/artifacts/print-farm-after-split.png", fullPage: true });
    return;
  }

  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Printers" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Filament" })).toBeVisible();
  await expect(page.locator(".pf-nongoals")).toHaveCount(1);
  await page.screenshot({ path: "/opt/cursor/artifacts/print-farm-after-split.png", fullPage: true });
});
