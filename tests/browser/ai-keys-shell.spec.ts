import { expect, test } from "@playwright/test";
import { expectHubReadyOrGate } from "./hub-org-gate";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("AI keys still loads after the panel split", async ({ page }) => {
  await page.goto("/team/ai-keys");
  await expect(page.getByRole("heading", { name: "AI API keys" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Application error");

  const mine = page.getByRole("heading", { name: "Use your own key, just for you" });
  const setup = page.getByRole("heading", { name: /choose (a|your) team|sign in/i });
  if (!(await expectHubReadyOrGate(page, mine, setup))) {
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
