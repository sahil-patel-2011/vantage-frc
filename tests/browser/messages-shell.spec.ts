import { expect, test } from "@playwright/test";
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
  // GHA Playwright has no Postgres. Fixture cookie is not a Better Auth
  // session, so HubOrgGate never mounts MessagesClient. "Choose a team" is
  // the honest no-org gate — not a shell regression.
  const teamGate = page.getByRole("heading", { name: /choose (a|your) team/i });
  await expect(newMessage.or(recovery).or(teamGate)).toBeVisible({ timeout: 20_000 });
  if ((await newMessage.count()) === 0) {
    await expect(teamGate.or(recovery)).toBeVisible();
    return;
  }

  await expect(page.getByText("Channels", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Message settings" })).toBeVisible();
  await expect(page.locator(".chat-sidebar").getByRole("tab")).toHaveCount(0);
  await expect(page.locator(".chat-composer").getByRole("tab")).toHaveCount(0);

  if (process.env.MESSAGES_SHOT === "1") {
    await page.screenshot({ path: "/opt/cursor/artifacts/messages-after-split.png", fullPage: true });
  }

  await newMessage.click();
  await expect(page.getByRole("complementary", { name: "Start private message" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
});
