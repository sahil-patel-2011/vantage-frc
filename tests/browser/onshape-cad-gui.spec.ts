import { expect, test, type Locator, type Page } from "@playwright/test";
import { signInFixture } from "./session";

/** Fixture cookie only — no Better Auth POST. Pair / vault / setup must still paint. */
test.beforeEach(async ({ context }) => {
  await signInFixture(context);
});

async function expectNeedsSetupChooseTeam(page: Page, chooseTeam: Locator) {
  await expect(chooseTeam).toBeVisible();
  await expect(page.getByText("Needs setup")).toBeVisible();
  await expect(page.getByRole("link", { name: "Choose your team" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Next actions" })).toHaveCount(0);
}

test("CAD vault paste-link offers Edit in Onshape or Needs setup", async ({ page }) => {
  await page.goto("/cad-vault");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByText("ONSHAPE_OAUTH_CLIENT_ID")).toHaveCount(0);
  await expect(page.getByText("vantage-cad")).toHaveCount(0);

  const heading = page.getByRole("heading", { level: 1, name: "CAD Vault" });
  await expect(heading).toBeVisible({ timeout: 20_000 });

  const chooseTeam = page.getByRole("heading", { name: "Choose your team", exact: true });
  const paste = page.getByPlaceholder(/cad\.onshape\.com\/documents/i).first();
  await expect(chooseTeam.or(paste)).toBeVisible({ timeout: 20_000 });

  if ((await chooseTeam.count()) > 0) {
    await expectNeedsSetupChooseTeam(page, chooseTeam);
    return;
  }

  await paste.fill("https://cad.onshape.com/documents/aaa111/w/bbb222/e/ccc333");
  await expect(page.getByRole("link", { name: /Edit( .* )?in Onshape/i }).first()).toBeVisible();
});

test("CAD setup wizard is link-first Edit in Onshape without env-var dumps", async ({ page }) => {
  await page.goto("/cad/setup");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByText("ONSHAPE_OAUTH_CLIENT_ID")).toHaveCount(0);
  await expect(page.getByText("vantage-cad")).toHaveCount(0);
  await expect(page.getByText("OAuth")).toHaveCount(0);

  const setupHeading = page.getByRole("heading", { level: 1, name: "CAD setup" });
  await expect(setupHeading).toBeVisible({ timeout: 20_000 });

  const chooseTeam = page.getByRole("heading", { name: "Choose your team", exact: true });
  const paste = page.getByPlaceholder(/cad\.onshape\.com\/documents/i).first();
  await expect(chooseTeam.or(paste)).toBeVisible({ timeout: 20_000 });

  if ((await chooseTeam.count()) > 0) {
    await expectNeedsSetupChooseTeam(page, chooseTeam);
    return;
  }

  await paste.fill("https://cad.onshape.com/documents/aaa111/w/bbb222/e/ccc333");
  await expect(page.getByRole("link", { name: /Edit( .* )?in Onshape/i }).first()).toBeVisible();
});

test("Pair this computer keeps its heading with the fixture cookie", async ({ page }) => {
  await page.goto("/cad/pair");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByRole("heading", { level: 1, name: /Pair this computer/i })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("OAuth")).toHaveCount(0);
  await expect(page.getByText("ONSHAPE_OAUTH")).toHaveCount(0);
});

test("CAD hub viewport can paste a document and click Edit in Onshape", async ({ page }) => {
  await page.goto("/build?tab=cad");
  await expect(page.locator("body")).not.toContainText("Application error");

  const chooseTeam = page.getByRole("heading", { name: /choose (a|your) team/i });
  const docInput = page.getByPlaceholder(/cad\.onshape\.com\/documents/i).first();
  await expect(docInput.or(chooseTeam)).toBeVisible({ timeout: 20_000 });
  if ((await docInput.count()) === 0) return;

  await docInput.fill("https://cad.onshape.com/documents/aaa111/w/bbb222/e/ccc333");
  const edit = page.getByRole("link", { name: /Edit( .* )?in Onshape/i }).first();
  await expect(edit).toBeVisible();
  await expect(page.getByRole("region", { name: "CAD viewport" })).toBeVisible();
  await edit.click();
});
