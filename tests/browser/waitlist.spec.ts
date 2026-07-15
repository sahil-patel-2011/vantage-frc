import { expect, test } from "@playwright/test";

test("a visitor can join the waitlist", async ({ page }) => {
  await page.goto("/");
  await page.locator("#waitlist").scrollIntoViewIfNeeded();
  await page.getByLabel("Email").fill(`browser-${Date.now()}@example.com`);
  await page.getByLabel("FRC team number").fill("254");
  await page.getByRole("button", { name: "Join the waitlist" }).click();
  await expect(page.getByRole("heading", { name: "You’re on the list." })).toBeVisible();
  await expect(page.getByText("does not create a Vantage account")).toBeVisible();
});
