import { expect, test } from "@playwright/test";
import { expectHubReadyOrGate } from "./hub-org-gate";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("AI keys still loads after the panel split", async ({ page }) => {
  await page.goto("/team/ai-keys");
  await expect(page.getByRole("heading", { level: 1, name: "AI keys" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Application error");

  const islandTeam = page.getByTestId("soft-island").getByRole("link", { name: "Team", exact: true });
  if (await islandTeam.isVisible()) {
    const href = await islandTeam.getAttribute("href");
    const orgId = href ? new URL(href, page.url()).searchParams.get("orgId") : null;
    if (orgId) {
      await page.goto(`/team/ai-keys?orgId=${encodeURIComponent(orgId)}`);
      await expect(page.getByRole("heading", { level: 1, name: "AI keys" })).toBeVisible();
    }
  }

  const mine = page.getByRole("heading", { name: "Use your own key, just for you" });
  const empty = page.getByRole("heading", { name: "Choose your team to add API keys" });
  const kms = page.getByRole("heading", { name: "Key encryption is not available" });
  if (!(await expectHubReadyOrGate(page, mine, empty.or(kms)))) {
    if (process.env.KEYS_SHOT === "1") {
      await page.screenshot({ path: "/opt/cursor/artifacts/ai-keys-after-split.png", fullPage: true });
    }
    return;
  }

  await expect(page.getByRole("region", { name: "My personal AI keys" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Provider API keys" })).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(0);

  if (process.env.KEYS_SHOT === "1") {
    await page.screenshot({ path: "/opt/cursor/artifacts/ai-keys-after-split.png", fullPage: true });
  }
});
