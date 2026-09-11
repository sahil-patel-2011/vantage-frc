import { expect, test } from "@playwright/test";
import { artifactScreenshot, expectReadyOr, waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("AI relays is a student paste-token page, not a Freebuff wrapper", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/team/relays", { waitUntil: "domcontentloaded" });
  await waitForLoadingGone(page);
  await expect(page.getByRole("heading", { level: 1, name: "AI relays" })).toBeVisible();

  await expect(page.getByRole("heading", { name: "Setup steps" })).toHaveCount(0);
  await expect(page.getByText("Setup required")).toHaveCount(0);
  await expect(page.getByText("Poll URL")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /bookmarklet|extension/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /bookmarklet|extension|wrap/i })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Related team tools" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Related team tools" })).toContainText("Connectors");
  await expect(page.getByRole("navigation", { name: "Related team tools" })).toContainText("Video");
  await expect(page.getByRole("navigation", { name: "Related team tools" })).toContainText("Storage");

  const setup = page.getByRole("heading", { name: "Choose your team" });
  const paste = page.getByRole("region", { name: "Paste the relay token" });
  const onSetup = await expectReadyOr(page, setup, paste);
  if (onSetup) {
    await expect(page.getByRole("heading", { name: "Next actions" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Choose your team" })).toBeVisible();
    await expect(page.getByText("Needs setup")).toBeVisible();
  } else {
    await expect(paste).toBeVisible();
    await expect(page.getByRole("button", { name: "Save this token" })).toBeVisible();
    if (await page.getByRole("heading", { name: "Paste the token from the Pi" }).isVisible()) {
      await expect(page.getByRole("heading", { name: "Next actions" })).toHaveCount(0);
    }
  }
  await artifactScreenshot(page, "relays-paste-token-after-shell.png");
});
