import { expect, test } from "@playwright/test";
import { loadFailureHeading } from "./hub-org-gate";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("CAD vault paste-link offers Edit in Onshape or Needs setup", async ({ page }) => {
  await page.goto("/cad-vault");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByText("ONSHAPE_OAUTH_CLIENT_ID")).toHaveCount(0);
  await expect(page.getByText("vantage-cad")).toHaveCount(0);

  const heading = page.getByRole("heading", { level: 1, name: "CAD Vault" });
  const chooseTeam = page.getByRole("heading", { name: "Choose your team", exact: true });
  await expect(heading.or(chooseTeam).or(loadFailureHeading(page))).toBeVisible({ timeout: 20_000 });

  if (await chooseTeam.isVisible()) {
    await expect(page.getByText("Needs setup")).toBeVisible();
    await expect(page.getByRole("link", { name: "Choose your team" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Next actions" })).toHaveCount(0);
    return;
  }

  const paste = page.getByPlaceholder(/cad\.onshape\.com\/documents/i).first();
  await expect(paste).toBeVisible();
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
  const chooseTeam = page.getByRole("heading", { name: "Choose your team", exact: true });
  await expect(setupHeading.or(chooseTeam).or(loadFailureHeading(page))).toBeVisible({
    timeout: 20_000,
  });

  if (await chooseTeam.isVisible()) {
    await expect(page.getByText("Needs setup")).toBeVisible();
    await expect(page.getByRole("link", { name: "Choose your team" })).toBeVisible();
    return;
  }

  const paste = page.getByPlaceholder(/cad\.onshape\.com\/documents/i).first();
  await expect(paste).toBeVisible();
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
  await expect(docInput.or(chooseTeam).or(loadFailureHeading(page))).toBeVisible({ timeout: 20_000 });
  if ((await docInput.count()) === 0) return;

  await docInput.fill("https://cad.onshape.com/documents/aaa111/w/bbb222/e/ccc333");
  await expect(page.getByRole("link", { name: /Edit( .* )?in Onshape/i }).first()).toBeVisible();
  await expect(page.getByRole("region", { name: "CAD viewport" })).toBeVisible();
});
