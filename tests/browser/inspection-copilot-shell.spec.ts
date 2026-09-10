import { expect, test } from "@playwright/test";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Inspection Copilot still loads after the panel split", async ({ page }) => {
  await page.goto("/inspection-copilot");
  await expect(page.getByRole("heading", { name: "Inspection-Readiness Copilot" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByRole("heading", { name: "Loading inspection copilot…" })).toBeHidden({
    timeout: 20_000,
  });

  const form = page.locator("#inspection-copilot-form");
  const setup = page.getByRole("button", { name: "Choose your team" });
  const retry = page.getByRole("button", { name: "Retry" });
  await expect(form.or(setup).or(retry)).toBeVisible({ timeout: 15_000 });

  if ((await form.count()) === 0) {
    return;
  }

  await expect(form).toBeVisible();
  await expect(page.getByText("default 115 until you set one")).toBeVisible();
  await expect(page.getByRole("button", { name: "Predict inspection failures" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Inspection Copilot summary" })).toBeVisible();
  await expect(form.getByRole("tab")).toHaveCount(0);

  if (process.env.INSPECTION_SHOT === "1") {
    await page.screenshot({ path: "/opt/cursor/artifacts/inspection-after-split.png", fullPage: true });
  }
});
