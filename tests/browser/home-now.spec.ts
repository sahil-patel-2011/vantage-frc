import { expect, test } from "@playwright/test";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Home shows one What to do now primary without TBA jargon", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.locator("body")).not.toContainText("Application error");
  const now = page.getByTestId("dash-now");
  await expect(now).toBeVisible();
  await expect(now.getByText("What to do now")).toBeVisible();
  await expect(now.getByRole("link")).toHaveCount(1);
  await expect(page.getByText("Connect TBA")).toHaveCount(0);
  await expect(page.getByText("The Blue Alliance")).toHaveCount(0);
  await expect(page.getByText("Student focus")).toHaveCount(0);
  await page.screenshot({ path: "/opt/cursor/artifacts/home-now-after.png", fullPage: true });
});
