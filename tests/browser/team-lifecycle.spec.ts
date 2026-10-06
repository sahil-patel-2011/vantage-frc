import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Pool } from "pg";
import { addSessionCookies, baseOrigin, LOCAL_FIXTURE_PASSWORD, normalizeLocalApiSession } from "./session";
test.use({ actionTimeout: 15_000 });

async function login(context: BrowserContext, email: string) {
  const response = await context.request.post("/api/auth/sign-in/email", { headers: { origin: baseOrigin() }, data: { email, password: LOCAL_FIXTURE_PASSWORD } });
  expect(response.status(), "Fresh account password sign-in").toBe(200);
  await normalizeLocalApiSession(context);
  await addSessionCookies(context, []);
}
async function profile(page: Page, firstName: string, role: "student" | "mentor", teamNumber?: number) {
  await page.goto("/onboarding");
  await page.getByLabel("First name", { exact: true }).fill(firstName);
  await page.getByLabel("Last name", { exact: true }).fill("Lifecycle");
  await page.getByRole("radio", { name: role === "student" ? /^Student/ : /^Mentor or teacher/ }).check();
  await page.getByLabel(/Date of birth/).fill(role === "student" ? "2010-01-01" : "1985-01-01");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByLabel("First name", { exact: true })).toHaveCount(0);
  if (teamNumber) {
    await page.getByLabel(/FRC team number/).fill(String(teamNumber));
    await page.getByRole("button", { name: "Continue", exact: true }).click();
  }
  await page.getByRole("checkbox", { name: /I agree to the Terms of Service/ }).check();
  await page.getByRole("checkbox", { name: /I agree to the Privacy Policy/ }).check();
}

for (const width of [1440, 390]) test(`student setup, invited mentor, student member and ownership handover at ${width}px`, async ({ page, context, browser }, info) => {
  test.setTimeout(180_000);
  const pool = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
  const starter = randomUUID(), lead = randomUUID(), student = randomUUID();
  const email = (id: string) => `${id}@vantage.local`;
  const leadContext = await browser.newContext({ baseURL: baseOrigin(), viewport: { width, height: 900 } });
  const studentContext = await browser.newContext({ baseURL: baseOrigin(), viewport: { width, height: 900 } });
  let orgId: string | undefined;
  try {
    for (const id of [starter, lead, student]) {
      await pool.query("INSERT INTO users(id,email,name,email_verified) VALUES($1,$2,'Lifecycle fixture',true)", [id, email(id)]);
      await pool.query("INSERT INTO accounts(account_id,provider_id,user_id,password) SELECT $1::text,'credential',$1::text::uuid,a.password FROM accounts a JOIN users u ON u.id=a.user_id WHERE u.email='e2e-owner@vantage.local' AND a.provider_id='credential'", [id]);
    }
    const available = await pool.query<{ teamNumber: number }>(`SELECT team_number AS "teamNumber" FROM teams_ref t WHERE NOT EXISTS(SELECT 1 FROM organizations o WHERE o.team_number=t.team_number) ORDER BY team_number LIMIT 1`);
    const teamNumber = available.rows[0]!.teamNumber;
    await login(context, email(starter));
    await page.setViewportSize({ width, height: 900 });
    await profile(page, "Starter", "student", teamNumber);
    const completed = page.waitForResponse(response => response.url().endsWith("/api/onboarding") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Submit access request", exact: true }).click();
    expect((await completed).ok()).toBe(true);
    await page.getByRole("link", { name: "Create this team", exact: true }).click();
    await expect(page.getByLabel("FRC team number", { exact: true })).toHaveValue(String(teamNumber));
    await page.getByLabel("Team name", { exact: true }).fill(`Lifecycle Team ${teamNumber}`);
    if (width === 390) await page.getByLabel("Team join code (optional)").fill("239487");
    await page.getByRole("checkbox", { name: /I agree to the Terms of Service/ }).check();
    await page.getByRole("checkbox", { name: /I agree to the Privacy Policy/ }).check();
    await page.getByRole("checkbox", { name: /I confirm I am a member/ }).check();
    const claimed = page.waitForResponse(response => response.url().endsWith("/api/organizations/claim") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Create team", exact: true }).click();
    const claimedResponse = await claimed;
    expect(claimedResponse.ok(), await claimedResponse.text()).toBe(true);
    orgId = (await claimedResponse.json()).id;
    expect(orgId).toBeTruthy();
    await expect(page).toHaveURL(/dashboard/);
    await expect(page.getByTestId("dash-customize")).toBeVisible();
    const initialCode = await context.request.get(`/api/organizations/join-code?orgId=${orgId}`);
    expect(initialCode.ok(), await initialCode.text()).toBe(true);
    expect((await initialCode.json()).pin).toMatch(width === 390 ? /^239487$/ : /^\d{6}$/);
    await expect(page.locator("main")).not.toContainText("recovery copy");
    expect((await pool.query("SELECT count(*)::int count FROM scout_schemas WHERE org_id=$1", [orgId])).rows[0].count).toBe(2);
    await page.goto(`/team/admin?orgId=${orgId}`);
    const invite = async (userId: string, access: "admin" | "scout") => {
      await page.getByLabel("Email", { exact: true }).fill(email(userId));
      await page.getByLabel("Team access", { exact: true }).selectOption(access);
      const response = page.waitForResponse(response => response.url().endsWith("/api/organizations/invites") && response.request().method() === "POST");
      await page.getByRole("button", { name: /^(Create invite|Send invite)$/ }).click();
      expect((await response).ok()).toBe(true);
    };
    await invite(lead, "admin"); await invite(student, "scout");
    const leadPage = await leadContext.newPage(); await login(leadContext, email(lead));
    await profile(leadPage, "Lead", "mentor");
    await leadPage.getByRole("button", { name: /^Join / }).click();
    await expect.poll(async () => (await (await leadContext.request.get("/api/onboarding")).json()).accessStatus).toBe("approved");
    const studentPage = await studentContext.newPage(); await login(studentContext, email(student));
    await profile(studentPage, "Student", "student");
    await studentPage.getByRole("button", { name: /^Join / }).click();
    await expect.poll(async () => (await (await studentContext.request.get("/api/onboarding")).json()).accessStatus).toBe("approved");
    expect((await studentContext.request.post("/api/organizations/invites", { data: { orgId, email: "blocked@example.test", role: "admin" } })).ok()).toBe(false);
    await page.reload();
    await page.getByRole("group", { name: "My team access", exact: true }).getByRole("button", { name: "Hand over team", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Hand over team", exact: true });
    await dialog.getByRole("combobox", { name: "New team owner", exact: true }).selectOption(lead);
    await dialog.getByRole("combobox", { name: "My access after this", exact: true }).selectOption("scout");
    expect((await new AxeBuilder({ page }).include(".team-handover-fields").analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`handover-${width}.png`), fullPage: false });
    const handed = page.waitForResponse(response => response.url().endsWith("/api/organizations/members") && response.request().method() === "PATCH");
    await dialog.getByRole("button", { name: "Hand over and update my access", exact: true }).click();
    expect((await handed).ok()).toBe(true);
    await expect(page).toHaveURL(/dashboard/);
    const roles = await pool.query("SELECT user_id,role FROM memberships WHERE org_id=$1", [orgId]);
    expect(roles.rows.find(row => row.user_id === starter)?.role).toBe("scout");
    expect(roles.rows.find(row => row.user_id === lead)?.role).toBe("owner");
    expect(roles.rows.find(row => row.user_id === student)?.role).toBe("scout");
    expect((await context.request.get(`/api/organizations/members?orgId=${orgId}`)).status()).toBe(403);
    expect((await leadContext.request.get(`/api/organizations/members?orgId=${orgId}`)).ok()).toBe(true);
  } finally {
    await leadContext.close(); await studentContext.close();
    if (orgId) await pool.query("DELETE FROM organizations WHERE id=$1", [orgId]);
    await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [[starter, lead, student]]);
    await pool.end();
  }
});
