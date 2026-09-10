import { expect, test } from "@playwright/test";
import { expectHubReadyOrGate, loadFailureHeading } from "./hub-org-gate";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Inventory still loads after the panel split", async ({ page }) => {
  await page.goto("/inventory");
  await expect(page.getByRole("heading", { level: 1, name: "Inventory & BOM" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Application error");

  const islandTeam = page.getByTestId("soft-island").getByRole("link", { name: "Team", exact: true });
  if (await islandTeam.isVisible()) {
    const href = await islandTeam.getAttribute("href");
    const orgId = href ? new URL(href, page.url()).searchParams.get("orgId") : null;
    if (orgId) {
      await page.goto(`/inventory?orgId=${encodeURIComponent(orgId)}`);
      await expect(page.getByRole("heading", { level: 1, name: "Inventory & BOM" })).toBeVisible();
    }
  }

  const tracked = page.getByText("Tracked items", { exact: true });
  const empty = page.getByRole("heading", { name: "Add a part before tracking stock" });
  const setup = page.getByRole("heading", { name: /Select a team|Choose a team|Finish setup/i });
  const unavailable = loadFailureHeading(page);
  if (!(await expectHubReadyOrGate(page, tracked, empty.or(setup).or(unavailable)))) {
    await expect(page.getByRole("tab")).toHaveCount(0);
    if (await empty.isVisible()) {
      await expect(page.getByRole("button", { name: "Add a part", exact: true })).toHaveCount(1);
      await expect(page.getByRole("navigation", { name: "Inventory sections" }).getByRole("tab")).toHaveCount(0);
    }
    await page.screenshot({ path: "/opt/cursor/artifacts/inventory-after-split.png", fullPage: true });
    return;
  }

  await expect(page.getByRole("navigation", { name: "Inventory sections" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Inventory sections" }).getByRole("tab")).toHaveCount(0);
  await expect(page.getByRole("tab")).toHaveCount(0);

  await page.screenshot({ path: "/opt/cursor/artifacts/inventory-after-split.png", fullPage: true });
});
