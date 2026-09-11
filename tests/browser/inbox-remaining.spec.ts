import { expect, test } from "@playwright/test";
import { loadFailureHeading } from "./hub-org-gate";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

const BANNED = [
  "Setup required",
  "Sponsor CRM",
  "TBA/reference",
  "Notification prefs",
  "Resend",
  "AUTH_EMAIL_FROM",
];

test("Inbox and preferences keep one primary and drop leftover engineering copy", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/notifications");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  const heading = page.getByRole("heading", { level: 1, name: "Notifications" });
  const sessionEnded = loadFailureHeading(page);
  await expect(heading.or(sessionEnded).first()).toBeVisible();
  for (const phrase of BANNED) {
    await expect(page.locator("body"), `inbox still shows ${phrase}`).not.toContainText(phrase);
  }
  await expect(page.getByRole("heading", { name: "Next actions" })).toHaveCount(0);
  if (await heading.isVisible()) {
    await expect(page.getByRole("link", { name: "Preferences" })).toBeVisible();
    const empty = page.getByRole("heading", { name: "No notifications yet" });
    if (await empty.isVisible()) {
      await expect(page.getByRole("button", { name: "Show all" })).toHaveCount(0);
      await page.getByRole("button", { name: "Unread" }).click();
      await expect(page.getByRole("heading", { name: "No unread notifications" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Show all" })).toHaveCount(1);
      await page.getByRole("button", { name: "Show all" }).click();
      await expect(page.getByRole("heading", { name: "No notifications yet" })).toBeVisible();
    }
  }

  await page.goto("/notifications/preferences");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  const prefsHeading = page.getByRole("heading", { level: 1, name: "Notification preferences" });
  await expect(prefsHeading.or(sessionEnded).first()).toBeVisible();
  for (const phrase of BANNED) {
    await expect(page.locator("body"), `prefs still shows ${phrase}`).not.toContainText(phrase);
  }
  await expect(page.getByRole("heading", { name: "Next actions" })).toHaveCount(0);
});
