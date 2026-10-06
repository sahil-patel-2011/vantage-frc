import { expect, test } from "@playwright/test";
import { expectHubReadyOrGate } from "./hub-org-gate";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("form type uses one native selector and keeps the selected editor", async ({ page }) => {
  await page.goto("/competition?tab=forms");
  await expect(page.getByRole("tab",{name:"Scout",exact:true})).toBeVisible();
  const types=page.getByRole("combobox",{name:"Form type",exact:true});
  if (!(await expectHubReadyOrGate(page, types))) return;
  await expect(page.getByRole("navigation",{name:"Tools in Scout",exact:true})).toHaveCount(0);
  await types.selectOption("pit"); await expect(types).toHaveValue("pit");
  await types.selectOption("match"); await expect(types).toHaveValue("match");
  await expect(page.getByRole("heading",{level:1,name:"Forms",exact:true})).toHaveCount(1);
  await expect(page.getByLabel("Form title",{exact:true})).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Application error");
});
