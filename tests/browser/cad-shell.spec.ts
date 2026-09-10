import { expect, test } from "@playwright/test";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("CAD hub still loads after the panel split", async ({ page }) => {
  await page.goto("/build?tab=cad");
  await expect(page.getByRole("tab", { name: "CAD" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Application error");

  const modes = page.getByRole("group", { name: "Agent mode" });
  const recovery = page.locator(".cad-agent-error strong");
  await expect(modes.or(recovery)).toBeVisible({ timeout: 20_000 });

  if ((await modes.count()) === 0) {
    await expect(recovery).toBeVisible();
    return;
  }

  await expect(page.locator(".cad-agent-brand")).toHaveText("CAD");
  await expect(modes.getByRole("button", { name: "Simple" })).toBeVisible();
  await expect(modes.getByRole("button", { name: "Plan" })).toBeVisible();
  await expect(modes.getByRole("button", { name: "Multitask" })).toBeVisible();
  await expect(modes.getByRole("button", { name: "Simple" })).toBeEnabled({ timeout: 20_000 });
  await expect(modes.getByRole("tab")).toHaveCount(0);

  await modes.getByRole("button", { name: "Plan" }).click();
  await expect(modes.getByRole("button", { name: "Plan" })).toHaveAttribute("aria-pressed", "true");
  await modes.getByRole("button", { name: "Simple" }).click();

  await expect(page.getByRole("region", { name: "Recent CAD activity" })).toBeVisible();

  if (process.env.CAD_SHOT === "1") {
    await page.screenshot({ path: "/opt/cursor/artifacts/cad-after-split.png", fullPage: true });
  }
});
