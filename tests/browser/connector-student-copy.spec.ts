import { expect, test } from "@playwright/test";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("/connectors does not print Onshape OAuth or Email (Resend)", async ({ page }) => {
  await page.goto("/connectors");
  const main = page.locator("#main-content");
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("Connectors");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByText("Onshape OAuth")).toHaveCount(0);
  await expect(page.getByText("Email (Resend)")).toHaveCount(0);
});
