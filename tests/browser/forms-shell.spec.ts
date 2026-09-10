import { expect, test } from "@playwright/test";
import { expectHubReadyOrGate } from "./hub-org-gate";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Form builder still loads after the panel split", async ({ page }) => {
  await page.goto("/competition?tab=forms");
  await expect(page.getByRole("tab", { name: "Forms" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Application error");

  const types = page.getByRole("navigation", { name: "Form type" });
  const recovery = page.locator(".sfb-shell-empty");
  if (!(await expectHubReadyOrGate(page, types, recovery))) return;

  await expect(types.getByRole("button", { name: "Match form" })).toBeVisible();
  await expect(types.getByRole("button", { name: "Pit form" })).toBeVisible();
  await expect(types.getByRole("tab")).toHaveCount(0);

  await types.getByRole("button", { name: "Pit form" }).click();
  await expect(types.getByRole("button", { name: "Pit form" })).toHaveAttribute("aria-current", "page");
  await types.getByRole("button", { name: "Match form" }).click();

  if (process.env.FORMS_SHOT === "1") {
    await page.screenshot({ path: "/opt/cursor/artifacts/forms-after-split.png", fullPage: true });
  }
});
