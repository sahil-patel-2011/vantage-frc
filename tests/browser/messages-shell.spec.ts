import { expect, test } from "@playwright/test";
import { expectHubReadyOrGate } from "./hub-org-gate";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Team chat still loads after the panel split", async ({ page }) => {
  await page.goto("/team?tab=messages");
  await expect(page.getByRole("tab", { name: "Chat" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Application error");

  const newMessage = page.getByRole("button", { name: "New Message" });
  const recovery = page.getByRole("button", { name: "Retry" });
  if (!(await expectHubReadyOrGate(page, newMessage, recovery))) return;

  await expect(page.getByText("Channels", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Message settings" })).toBeVisible();
  await expect(page.locator(".chat-sidebar").getByRole("tab")).toHaveCount(0);
  await expect(page.locator(".chat-composer").getByRole("tab")).toHaveCount(0);

  if (process.env.MESSAGES_SHOT === "1") {
    await page.screenshot({ path: "/opt/cursor/artifacts/messages-after-split.png", fullPage: true });
  }

  await newMessage.click();
  const picker = page.getByRole("complementary", { name: "Start private message" });
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: "Close" }).click();
});
