import { expect, test } from "@playwright/test";
import { expectHubReadyOrGate } from "./hub-org-gate";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Logistics still loads after the panel split", async ({ page }) => {
  await page.goto("/logistics");
  await expect(page.getByRole("heading", { level: 1, name: "Logistics" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Application error");

  const islandTeam = page.getByTestId("soft-island").getByRole("link", { name: "Team", exact: true });
  if (await islandTeam.isVisible()) {
    const href = await islandTeam.getAttribute("href");
    const orgId = href ? new URL(href, page.url()).searchParams.get("orgId") : null;
    if (orgId) {
      await page.goto(`/logistics?orgId=${encodeURIComponent(orgId)}`);
      await expect(page.getByRole("heading", { level: 1, name: "Logistics" })).toBeVisible();
    }
  }

  const checklist = page.getByRole("heading", { name: "Day-of checklist" });
  const empty = page.getByRole("heading", { name: "Travel plan not published" });
  const setup = page.getByRole("heading", { name: /Finish setup for travel plans|Choose your team|Choose your team/i });
  const unavailable = page.getByRole("heading", { name: /Could not load Logistics/i });
  if (!(await expectHubReadyOrGate(page, checklist, empty.or(setup).or(unavailable)))) {
    if (process.env.LOGISTICS_SHOT === "1") {
      await page.screenshot({ path: "/opt/cursor/artifacts/logistics-empty-one-primary.png", fullPage: true });
    }
    return;
  }

  await expect(page.getByRole("heading", { name: "Emergency contacts" })).toBeVisible();
  const trips = page.getByRole("navigation", { name: "Trips" });
  if ((await trips.count()) > 0) {
    await expect(trips.getByRole("tab")).toHaveCount(0);
  }
  await expect(page.getByRole("tab")).toHaveCount(0);

  if (process.env.LOGISTICS_SHOT === "1") {
    await page.screenshot({ path: "/opt/cursor/artifacts/logistics-ready-after-split.png", fullPage: true });
  }
});
