import { expect, test } from "@playwright/test";

test("a visitor can join the waitlist", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your FRC team, in one place." })).toBeVisible();
  const finalForm = page.locator("#waitlist");
  await finalForm.scrollIntoViewIfNeeded();
  await finalForm.getByLabel("Email").fill(`browser-${Date.now()}@example.com`);
  await finalForm.getByLabel("FRC team number").fill("254");
  const join = finalForm.getByRole("button", { name: "Join the waitlist" });
  await expect(join).toBeEnabled();
  await finalForm.getByRole("checkbox", { name: /I agree to the Terms of Service/i }).check();
  await join.click();
  await expect(page.getByRole("heading", { name: "You’re on the list." })).toBeVisible();
  await expect(page.getByText("does not create a Vantage account")).toBeVisible();
});
