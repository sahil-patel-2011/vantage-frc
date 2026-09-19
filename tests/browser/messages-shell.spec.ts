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
  // The control is labelled "Settings" inside Chat — "Message settings" is the
  // heading of the panel it opens, which is the part worth asserting. Checking
  // the destination rather than the word on the button means a future rename
  // of the label does not fail a test about the panel existing.
  const chatSettings = page.locator("#main-content").getByRole("button", { name: "Settings", exact: true });
  await expect(chatSettings).toBeVisible();
  await expect(page.locator(".chat-sidebar").getByRole("tab")).toHaveCount(0);
  await expect(page.locator(".chat-composer").getByRole("tab")).toHaveCount(0);

  if (process.env.MESSAGES_SHOT === "1") {
    await page.screenshot({ path: "test-results/messages-after-split.png", fullPage: true });
  }

  await newMessage.click();
  const picker = page.getByRole("complementary", { name: "Start private message" });
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: "Close" }).click();
});
