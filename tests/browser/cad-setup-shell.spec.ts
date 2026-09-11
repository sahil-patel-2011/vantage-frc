import { expect, test } from "@playwright/test";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("CAD setup is a student wizard without CLI or env-var dumps", async ({ page }) => {
  await page.goto("/cad/setup");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("VANTAGE /")).toHaveCount(0);
  await expect(page.getByText("ONSHAPE_OAUTH_CLIENT_ID")).toHaveCount(0);
  await expect(page.getByText("vantage-cad")).toHaveCount(0);
  await expect(page.getByText("Copy commands")).toHaveCount(0);
  await expect(page.getByText("AI brain")).toHaveCount(0);
});

test("CAD pair is student copy without OAuth or CLI dumps", async ({ page }) => {
  await page.goto("/cad/pair");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByRole("heading", { level: 1, name: /Approve this computer/i })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("VANTAGE /")).toHaveCount(0);
  await expect(page.getByText("OAuth")).toHaveCount(0);
  await expect(page.getByText("vantage-cad")).toHaveCount(0);
  await expect(page.getByText("Vercel")).toHaveCount(0);
});
