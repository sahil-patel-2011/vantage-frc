import { expect, test } from "@playwright/test";
import { expectReadyOr, waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Video is a student paste page, not an engineering wall", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/video-analysis", { waitUntil: "domcontentloaded" });
  await waitForLoadingGone(page);
  await expect(page.getByRole("heading", { level: 1, name: "Video" })).toBeVisible();

  await expect(page.getByRole("heading", { name: "Setup steps" })).toHaveCount(0);
  await expect(page.getByText("org-scoped")).toHaveCount(0);
  await expect(page.getByText("video jobs")).toHaveCount(0);
  await expect(page.getByText("Pick a team first")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Analyze video" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Related competition tools" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Related competition tools" })).toContainText("Match notes");
  await expect(page.getByRole("navigation", { name: "Related competition tools" })).toContainText("Match video");
  await expect(page.getByRole("navigation", { name: "Related competition tools" })).toContainText("Event day");
  await expect(page.getByRole("navigation", { name: "Related competition tools" })).not.toContainText("AI relays");

  const setup = page.getByRole("heading", { name: "Choose your team" });
  const paste = page.getByRole("region", { name: "Paste a video" });
  const onSetup = await expectReadyOr(page, setup, paste);
  if (onSetup) {
    await expect(page.getByRole("heading", { name: "Next actions" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Choose your team" })).toBeVisible();
  } else {
    await expect(page.getByRole("button", { name: "Pair a video Pi" })).toHaveCount(0);
    if (await page.getByRole("heading", { name: "Paste a match or pit video" }).isVisible()) {
      await expect(page.getByRole("heading", { name: "Next actions" })).toHaveCount(0);
    }
  }
  await page.screenshot({ path: "/opt/cursor/artifacts/video-analysis-after-shell.png", fullPage: true });
});
