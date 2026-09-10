import { expect, test } from "@playwright/test";
import { expectHubReadyOrGate } from "./hub-org-gate";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Code Coach hub still loads after the panel split", async ({ page }) => {
  await page.goto("/build?tab=code");
  await expect(page.getByRole("tab", { name: "Code" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Application error");

  const coach = page.getByRole("heading", { name: "Code Coach pattern review" });
  if (!(await expectHubReadyOrGate(page, coach))) return;

  await expect(page.getByRole("heading", { name: "AI Bugbot" })).toBeVisible();
  const modes = page.getByRole("group", { name: "Bugbot billing mode" });
  await expect(modes).toBeVisible();
  await expect(modes.getByRole("button", { name: /On your subscription/ })).toBeVisible();
  await expect(modes.getByRole("button", { name: /Bugbot Ultra/ })).toBeVisible();
  await expect(modes.getByRole("tab")).toHaveCount(0);

  await expect(page.getByText("blocking robot loop")).toHaveCount(0);

  if (process.env.CODE_SHOT === "1") {
    await page.screenshot({ path: "/opt/cursor/artifacts/code-after-split.png", fullPage: true });
  }
});
