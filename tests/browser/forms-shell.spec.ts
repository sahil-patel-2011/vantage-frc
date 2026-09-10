import { expect, test } from "@playwright/test";
import { expectHubReadyOrGate } from "./hub-org-gate";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Form builder still loads after the panel split", async ({ page }) => {
  await page.goto("/competition?tab=forms");
  await expect(page.getByRole("tab", { name: "Scouting" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Application error");

  const tools = page.getByRole("navigation", { name: "Tools in Scouting" });
  const formsChip = tools.getByRole("button", { name: "Forms", exact: true });
  const types = page.getByRole("navigation", { name: "Form type" });
  const settledEmpty = page.locator(".sfb-shell-empty:not([aria-busy='true'])");
  const opening = page.getByRole("heading", { name: "Opening your team" });

  if (!(await expectHubReadyOrGate(page, tools))) {
    if (process.env.FORMS_SHOT === "1") {
      await page.screenshot({ path: "/opt/cursor/artifacts/forms-after-split.png", fullPage: true });
    }
    return;
  }

  await expect(formsChip).toBeVisible();
  await expect(tools.getByRole("tab")).toHaveCount(0);

  await expect(opening).toHaveCount(0, { timeout: 20_000 });
  if ((await types.count()) === 0 && (await settledEmpty.count()) === 0) {
    await formsChip.click();
  }

  if (!(await expectHubReadyOrGate(page, types, settledEmpty))) {
    if (process.env.FORMS_SHOT === "1") {
      await page.screenshot({ path: "/opt/cursor/artifacts/forms-after-split.png", fullPage: true });
    }
    return;
  }
  if ((await types.count()) === 0) {
    if (process.env.FORMS_SHOT === "1") {
      await page.screenshot({ path: "/opt/cursor/artifacts/forms-after-split.png", fullPage: true });
    }
    return;
  }

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
