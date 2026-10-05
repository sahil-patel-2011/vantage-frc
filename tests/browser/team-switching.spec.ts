import { expect, test } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { signInAs } from "./session";
import { primaryNavigation } from "./nav";

const homeOrg = "6925a000-0000-4000-8000-000000000001";
const ownerId = "6925e2e0-0000-4000-8000-000000000001";
test.use({ actionTimeout: 15_000 });

for (const width of [390, 1440]) test(`switching teams updates data, permissions and Home at ${width}px`, async ({ page, context }) => {
  const url = new URL(process.env.DATABASE_ADMIN_URL!);
  expect(["localhost", "127.0.0.1"]).toContain(url.hostname);
  expect(url.pathname).toMatch(/test|ci/);
  const pool = new Pool({ connectionString: url.toString(), ssl: false });
  const orgId = randomUUID();
  const marker = `Switch audit ${randomUUID()}`;
  await pool.query("INSERT INTO organizations(id,name,slug,team_number) VALUES($1,$2,$3,99992)", [orgId, marker, marker.toLowerCase().replaceAll(" ", "-")]);
  try {
    await pool.query("INSERT INTO memberships(org_id,user_id,role) VALUES($1,$2,'scout')", [orgId, ownerId]);
    await pool.query("UPDATE org_auth_policies SET allow_password=true WHERE org_id=$1", [orgId]);
    expect(await signInAs(context, "owner")).toBe(true);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/competition?tab=scouting&mode=free&orgId=${homeOrg}&reportId=previous-team-record`);
    await expect(page.getByRole("heading", { name: "Scout without an event" })).toBeVisible();
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menu", { name: "Account" }).getByRole("menuitem").filter({ hasText: marker }).click();
    await expect(page).toHaveURL(new RegExp(orgId));
    expect(new URL(page.url()).searchParams.has("reportId")).toBe(false);
    await expect(page.getByRole("heading", { name: "Scout without an event" })).toBeVisible();
    await page.getByRole("button", { name: "Account menu" }).click();
    await expect(page.getByRole("menu", { name: "Account" }).getByRole("menuitem", { name: "Team admin", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.getByLabel("Team number", { exact: true }).fill("99992");
    await page.getByLabel("Session or match").fill(marker);
    await page.getByRole("combobox", { name: "Form", exact: true }).selectOption("pit");
    await page.getByRole("button", { name: "Start scouting", exact: true }).click();
    await page.getByRole("textbox", { name: "Notes", exact: true }).fill("Saved after switching teams");
    await page.getByRole("button", { name: "Save report", exact: true }).click();
    await expect(page.locator(".free-scout-report").filter({ hasText: marker }).getByText("Uploaded", { exact: true })).toBeVisible();
    const saved = await pool.query("SELECT org_id FROM free_scout_reports WHERE label=$1", [marker]);
    expect(saved.rows).toEqual([{ org_id: orgId }]);
    await primaryNavigation(page).getByRole("link", { name: "Home", exact: true }).click();
    // The org is already in the scouting URL. Wait for the destination too,
    // otherwise the test opens a menu on the page that is still leaving.
    await expect(page).toHaveURL(new RegExp(`/dashboard\\?orgId=${orgId}`));
    await expect(page.getByRole("button", { name: "Edit Home — rearrange, add, or remove widgets" })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Account menu" }).click();
    await expect(page.getByRole("menu", { name: "Account" }).locator(".soft-account-org").first()).toContainText(marker);
    await page.getByRole("menuitem", { name: "Account and settings" }).click();
    await expect(page).toHaveURL(new RegExp(`/account\\?orgId=${orgId}`));
    await expect(page.getByRole("tablist", { name: "Account sections" })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Account menu" }).click();
    await expect(page.getByRole("menu", { name: "Account" }).getByRole("menuitem", { name: "Team admin", exact: true })).toHaveCount(0);
    await page.getByRole("menuitem").filter({ hasText: "Team 6925" }).click();
    await expect(page).toHaveURL(new RegExp(`orgId=${homeOrg}`));
    await page.getByRole("button", { name: "Account menu" }).click();
    await expect(page.getByRole("menuitem", { name: "Team admin", exact: true })).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`orgId=${homeOrg}`));
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`orgId=${orgId}`));
    await page.getByRole("button", { name: "Account menu" }).click();
    await expect(page.getByRole("menu", { name: "Account" }).locator(".soft-account-org").first()).toContainText(marker);
    await expect(page.getByRole("menuitem", { name: "Team admin", exact: true })).toHaveCount(0);
  } finally {
    await pool.query("DELETE FROM free_scout_reports WHERE label=$1", [marker]);
    await pool.query("DELETE FROM organizations WHERE id=$1 AND name=$2", [orgId, marker]);
    await pool.end();
  }
});
