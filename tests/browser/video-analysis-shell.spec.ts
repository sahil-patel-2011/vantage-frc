import { expect, test } from "@playwright/test";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Video is a student paste page, not an engineering wall", async ({ page }) => {
  await page.goto("/video-analysis");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByRole("heading", { level: 1, name: "Video" })).toBeVisible();
  await page
    .getByRole("heading", { name: "Loading Video…" })
    .waitFor({ state: "hidden", timeout: 12_000 })
    .catch(() => undefined);

  await expect(page.getByRole("heading", { name: "Setup steps" })).toHaveCount(0);
  await expect(page.getByText("org-scoped")).toHaveCount(0);
  await expect(page.getByText("video jobs")).toHaveCount(0);
  await expect(page.getByText("Pick a team first")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Analyze video" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Related competition tools" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Related competition tools" })).toContainText("Match notes");
  await expect(page.getByRole("navigation", { name: "Related competition tools" })).toContainText("Match video");
  await expect(page.getByRole("navigation", { name: "Related competition tools" })).toContainText("AI relays");

  const setup = page.getByRole("heading", { name: "Choose your team" });
  if (await setup.isVisible()) {
    await expect(page.getByRole("heading", { name: "Next actions" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Choose your team" })).toBeVisible();
  } else {
    await expect(page.getByRole("region", { name: "Paste a video" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Pair a video Pi" })).toHaveCount(0);
    if (await page.getByRole("heading", { name: "Paste a match or pit video" }).isVisible()) {
      await expect(page.getByRole("heading", { name: "Next actions" })).toHaveCount(0);
    }
  }
  await page.screenshot({ path: "/opt/cursor/artifacts/video-analysis-after-shell.png", fullPage: true });
});
