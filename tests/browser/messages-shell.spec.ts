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
  // The control is labelled "Chat settings" — "Message settings" is the
  // heading of the panel it opens, which is the part worth asserting. Checking
  // the destination rather than the word on the button means a future rename
  // of the label does not fail a test about the panel existing.
  const chatSettings = page.locator("#main-content").getByRole("button", { name: "Chat settings", exact: true });
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

/*
  Usability testers at 390px found the message box squeezed to one letter per
  line, the channel list crushed into a sideways strip, and the page scrolling
  sideways. Phones now get the list, then one conversation full width. This
  walks that without sending anything, so it leaves no rows behind.
*/
test("Team chat on a phone: list, then a full-width conversation, no sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/team?tab=messages");

  const newMessage = page.getByRole("button", { name: "New message" });
  const recovery = page.getByRole("button", { name: "Retry" });
  if (!(await expectHubReadyOrGate(page, newMessage, recovery))) return;

  const noSidewaysScroll = () =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(await noSidewaysScroll()).toBe(true);

  const channel = page.locator(".chat-sidebar button[aria-current], .chat-sidebar button.active").first();
  if (!(await channel.isVisible())) return;
  await channel.click();

  const box = page.getByRole("textbox", { name: "Message", exact: true });
  await expect(box).toBeVisible();
  const width = (await box.boundingBox())?.width ?? 0;
  expect(width, "message box should fill the row beside Link and Send").toBeGreaterThan(200);
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
  await expect(page.locator(".chat-sidebar")).toBeHidden();
  expect(await noSidewaysScroll()).toBe(true);

  // Per-message actions are one labelled "…" menu, not a row of buttons.
  const actions = page.getByRole("button", { name: /^Message actions/ });
  if ((await actions.count()) > 0) {
    await expect(page.locator(".messages article").getByRole("button", { name: /^(Pin note|Report|Remove)$/ })).toHaveCount(0);
    await actions.first().click();
    const menu = page.getByRole("menu", { name: "Message actions" });
    await expect(menu).toBeVisible();
    const first = menu.getByRole("menuitem").first();
    await expect(first).toBeFocused();
    const font = await first.evaluate((node) => getComputedStyle(node).fontFamily);
    expect(font).not.toMatch(/mono/i);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(actions.first()).toBeFocused();
  }

  await page.getByRole("button", { name: /All chats/ }).click();
  await expect(page.locator(".chat-sidebar")).toBeVisible();
  await expect(box).toBeHidden();
});
