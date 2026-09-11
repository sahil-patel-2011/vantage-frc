import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("CAD setup and pair keep student headings without Onshape iframes", async ({ page }) => {
  await page.goto("/cad/setup");
  await waitForLoadingGone(page);
  await expect(page.getByRole("heading", { level: 1, name: "CAD setup" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(page.getByText("ONSHAPE_OAUTH")).toHaveCount(0);

  await page.goto("/cad/pair");
  await waitForLoadingGone(page);
  await expect(page.getByRole("heading", { level: 1, name: /Pair this computer/i })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(page.getByText("OAuth")).toHaveCount(0);
});

test("CAD hub viewport is a picture pane, not an Onshape embed", async ({ page }) => {
  await page.goto("/build?tab=cad");
  await waitForLoadingGone(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("iframe[src*='onshape.com']")).toHaveCount(0);
  const viewport = page.getByRole("region", { name: "CAD viewport" });
  const gate = page.getByRole("heading", { name: /choose (a|your) team/i });
  await expect(viewport.or(gate).or(page.getByRole("tab", { name: "CAD" }))).toBeVisible({
    timeout: 20_000,
  });
  if (await viewport.count()) {
    await expect(viewport.locator("iframe")).toHaveCount(0);
  }
});
