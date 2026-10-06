import { expect, test } from "@playwright/test";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("manual view and season filters have one working native selector each", async ({ page }) => {
  await page.goto("/docs"); await expect(page.getByRole("heading",{name:"App manual"})).toBeVisible();
  const views=page.getByRole("combobox",{name:"Manual views",exact:true});
  await expect(views).toHaveValue("topics"); await expect(views.getByRole("option")).toHaveCount(2);
  await views.selectOption("sections"); await expect(page.getByRole("heading",{name:"How Vantage works, section by section"})).toBeVisible();
  const moments=page.getByRole("combobox",{name:"Season moment",exact:true});
  await expect(moments).toHaveValue("all");
  await moments.selectOption({label:"Competition day"});
  await expect(page.locator(".section-guide-count")).toContainText("Between matches, in the pit and the stands.");
  await expect(moments).not.toHaveValue("all");
});
