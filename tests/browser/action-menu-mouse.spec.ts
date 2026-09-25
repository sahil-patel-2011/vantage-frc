import { expect, test } from "@playwright/test";
import { signInAs } from "./session";

// A mouse click on "More" opened the menu and a scroll caused by moving focus into it closed
// it again within 50 ms; only the keyboard could reach Edit, Duplicate and Delete.
test("a saved TV board's More menu stays open after a mouse click", async ({ page, context }) => {
  const signed = await signInAs(context, "owner");
  test.skip(!signed, "no local session");
  await page.goto("/display");
  const more = page.getByRole("button", { name: /More/ }).first();
  await expect(more).toBeVisible({ timeout: 60_000 });
  await more.click();
  await expect(page.getByRole("menuitem").first()).toBeVisible();
  await expect(more).toHaveAttribute("aria-expanded", "true");
});
