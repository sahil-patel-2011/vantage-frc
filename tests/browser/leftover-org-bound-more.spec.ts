import { expect, test } from "@playwright/test";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Help and Attendance drop leftover engineering copy", async ({ page }) => {
  await page.goto("/help/getting-started");
  await expect(page.getByRole("heading", { name: "Set up a new team, start to first event" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Permalink" })).toHaveCount(0);

  await page.goto("/attendance");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByText("workspace members")).toHaveCount(0);
});
