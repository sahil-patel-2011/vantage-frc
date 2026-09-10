import { expect, test } from "@playwright/test";
import { expectHubReadyOrGate } from "./hub-org-gate";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Team admin still loads after the panel split", async ({ page }) => {
  await page.goto("/team/admin");
  await expect(page.getByRole("heading", { level: 1, name: "Team admin" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Application error");

  const islandTeam = page.getByTestId("soft-island").getByRole("link", { name: "Team", exact: true });
  if (await islandTeam.isVisible()) {
    const href = await islandTeam.getAttribute("href");
    const orgId = href ? new URL(href, page.url()).searchParams.get("orgId") : null;
    if (orgId) {
      await page.goto(`/team/admin?orgId=${encodeURIComponent(orgId)}`);
      await expect(page.getByRole("heading", { level: 1, name: "Team admin" })).toBeVisible();
    }
  }

  const invite = page.getByRole("heading", { name: "Add a teammate" });
  const empty = page.getByRole("heading", { name: /Select a team|Choose a team|Finish setup/i });
  if (!(await expectHubReadyOrGate(page, invite, empty))) {
    if (process.env.ADMIN_SHOT === "1") {
      await page.screenshot({ path: "/opt/cursor/artifacts/team-admin-after-split.png", fullPage: true });
    }
    return;
  }

  await expect(page.getByRole("heading", { name: "GitHub" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Approve who enters this team." })).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(0);

  if (process.env.ADMIN_SHOT === "1") {
    await page.screenshot({ path: "/opt/cursor/artifacts/team-admin-after-split.png", fullPage: true });
  }
});
