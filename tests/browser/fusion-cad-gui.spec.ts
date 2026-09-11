import { expect, test, type Locator, type Page } from "@playwright/test";
import { signInFixture } from "./session";

/** Fixture cookie only — no Better Auth POST. Vault / setup / connections must still paint. */
test.beforeEach(async ({ context }) => {
  await signInFixture(context);
});

async function expectNeedsSetupChooseTeam(page: Page, chooseTeam: Locator) {
  await expect(chooseTeam).toBeVisible();
  await expect(page.getByText("Needs setup")).toBeVisible();
  await expect(page.getByRole("link", { name: "Choose your team" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Next actions" })).toHaveCount(0);
}

test("CAD vault paste-link offers Edit in Fusion or Needs setup", async ({ page }) => {
  await page.goto("/cad-vault");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByText("FUSION_RELAY_SIGNING_SECRET")).toHaveCount(0);
  await expect(page.getByText("vantage-cad")).toHaveCount(0);

  const heading = page.getByRole("heading", { level: 1, name: "CAD Vault" });
  await expect(heading).toBeVisible({ timeout: 20_000 });

  const chooseTeam = page.getByRole("heading", { name: "Choose your team", exact: true });
  const paste = page.getByPlaceholder(/a360\.co/i).first();
  await expect(chooseTeam.or(paste)).toBeVisible({ timeout: 20_000 });

  if ((await chooseTeam.count()) > 0) {
    await expectNeedsSetupChooseTeam(page, chooseTeam);
    return;
  }

  await paste.fill("https://a360.co/3AbCdEf");
  await expect(page.getByRole("link", { name: /Edit( .* )?in Fusion/i }).first()).toBeVisible();
});

test("CAD setup wizard is link-first Edit in Fusion without env-var dumps", async ({ page }) => {
  await page.goto("/cad/setup");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByText("FUSION_RELAY_SIGNING_SECRET")).toHaveCount(0);
  await expect(page.getByText("vantage-cad")).toHaveCount(0);
  await expect(page.getByText("OAuth")).toHaveCount(0);

  const setupHeading = page.getByRole("heading", { level: 1, name: "CAD setup" });
  await expect(setupHeading).toBeVisible({ timeout: 20_000 });

  const chooseTeam = page.getByRole("heading", { name: "Choose your team", exact: true });
  const fusionChoice = page.getByText("Fusion on this computer", { exact: true });
  await expect(chooseTeam.or(fusionChoice)).toBeVisible({ timeout: 20_000 });

  if ((await chooseTeam.count()) > 0) {
    await expectNeedsSetupChooseTeam(page, chooseTeam);
    return;
  }

  await page.getByRole("radio", { name: /Fusion on this computer/i }).check();
  const paste = page.getByPlaceholder(/a360\.co/i).first();
  await expect(paste).toBeVisible();
  await paste.fill("https://a360.co/3AbCdEf");
  await expect(page.getByRole("link", { name: /Edit( .* )?in Fusion/i }).first()).toBeVisible();
});

test("CAD connections Fusion tile is paste-link Edit in Fusion or Needs setup", async ({ page }) => {
  await page.goto("/cad/connections");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.getByText("FUSION_RELAY_SIGNING_SECRET")).toHaveCount(0);
  await expect(page.getByText("vantage-cad")).toHaveCount(0);

  const heading = page.getByRole("heading", { level: 1, name: "CAD connections" });
  await expect(heading).toBeVisible({ timeout: 20_000 });

  const chooseTeam = page.getByRole("heading", { name: "Choose your team", exact: true });
  const fusionTile = page.locator("#fusion");
  await expect(chooseTeam.or(fusionTile)).toBeVisible({ timeout: 20_000 });

  if ((await chooseTeam.count()) > 0) {
    await expectNeedsSetupChooseTeam(page, chooseTeam);
    return;
  }

  await expect(fusionTile.getByRole("heading", { name: "Fusion" })).toBeVisible();
  const paste = fusionTile.getByPlaceholder(/a360\.co/i);
  await expect(paste).toBeVisible();
  await paste.fill("https://a360.co/3AbCdEf");
  await expect(fusionTile.getByRole("link", { name: /Edit( .* )?in Fusion/i })).toBeVisible();
});
