import { createHmac, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { expect, test } from "@playwright/test";
import { baseOrigin, fixtureAccount, signInAs, normalizeLocalApiSession } from "./session";
import { serializeConsent } from "../../apps/web/lib/product-analytics/consent";

test("scratch team, exact-email signup, invitation acceptance and role-correct Home", async ({ browser }) => {
  test.setTimeout(300_000);
  const url = new URL(process.env.DATABASE_ADMIN_URL!);
  expect(["localhost", "127.0.0.1"]).toContain(url.hostname);
  expect(url.pathname).toMatch(/test|ci/);
  const pool = new Pool({ connectionString: url.toString(), ssl: false });
  const marker = `UI journey ${randomUUID()}`;
  const email = `ui-invite-${randomUUID()}@example.test`;
  const options = { baseURL: baseOrigin(), storageState: { cookies: [{ name: "vantage-analytics-consent", value: serializeConsent("denied"), domain: new URL(baseOrigin()).hostname, path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" as const }], origins: [] } };
  const platform = await browser.newContext(options);
  const owner = await browser.newContext(options);
  const invited = await browser.newContext(options);
  let orgId: string | null = null;
  const headers = { origin: baseOrigin() };
  try {
    expect(await signInAs(platform, "platform")).toBe(true);
    expect(await signInAs(owner, "owner")).toBe(true);
    const teamNumber = (await pool.query("SELECT n FROM generate_series(99000,99990) n WHERE NOT EXISTS(SELECT 1 FROM organizations WHERE team_number=n) LIMIT 1")).rows[0].n;
    const created = await platform.request.post("/api/admin/organizations", { headers, data: { name: marker, slug: marker.toLowerCase().replaceAll(" ", "-"), teamNumber, ownerEmail: fixtureAccount("owner").email } });
    expect(created.status(), await created.text()).toBe(201);
    orgId = (await created.json()).id;
    expect(orgId).toBeTruthy();
    const invitation = await owner.request.post("/api/organizations/invites", { headers, data: { orgId, email, role: "scout" } });
    expect(invitation.status(), await invitation.text()).toBe(201);
    const link = new URL((await invitation.json()).inviteUrl, baseOrigin());
    // Provider email delivery is intentionally not claimed by this local journey.
    const page = await invited.newPage();
    await page.goto(`${link.pathname}${link.search}`);
    await page.getByRole("link", { name: "Sign in to accept" }).click();
    await page.getByRole("textbox", { name: "Email", exact: true }).fill(email);
    await page.getByRole("button", { name: "Email me a sign-in code", exact: true }).click();
    const otp = String(createHmac("sha256", process.env.DEV_OTP_SECRET ?? "vantage-local-otp").update(`${email}:sign-in`).digest().readUInt32BE(0) % 1_000_000).padStart(6, "0");
    await page.locator("input[autocomplete=one-time-code]").fill(otp);
    await expect.poll(() => page.evaluate(async () => (await (await fetch("/api/auth/get-session")).json())?.user?.email)).toBe(email);
    await normalizeLocalApiSession(invited);
    await expect.poll(async () => (await invited.request.get("/api/auth/get-session")).json().then(data => data?.user?.email)).toBe(email);
    const ineligible = await invited.request.post("/api/invites/accept", { headers, data: { token: link.searchParams.get("token"), termsAccepted: true, privacyAccepted: true } });
    expect(ineligible.status()).toBe(403);
    // Complete the real first screen, including its persisted progress.
    await page.getByRole("link", { name: "Finish your profile", exact: true }).click();
    await expect(page).toHaveURL(/\/onboarding(?:\?|$)/, { timeout: 60_000 });
    await page.getByLabel("First name", { exact: true }).fill("Journey");
    await page.getByLabel("Last name", { exact: true }).fill("Scout");
    await page.getByRole("radio", { name: /^Student/ }).check();
    await page.getByLabel(/Date of birth/).fill("2005-01-01");
    await page.getByLabel(/Gender/).selectOption("prefer_not_to_say");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    // An exact-email invite already supplies the team and role, so setup skips
    // asking the new scout to choose those details again.
    await expect(page.getByRole("region", { name: "Access request summary", exact: true })).toBeVisible();
    await page.getByRole("checkbox", { name: /Terms of Service/ }).check();
    await page.getByRole("checkbox", { name: /Privacy Policy/ }).check();
    await page.getByRole("button", { name: new RegExp(`^Join ${marker}`) }).click();
    await expect.poll(async () => (await pool.query("SELECT role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 AND u.email=$2", [orgId, email])).rows[0]?.role).toBe("scout");
    await page.getByRole("link", { name: "Open Home", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 60_000 });
    await expect(page.getByTestId("dash-customize")).toBeVisible({ timeout: 30_000 });
    const me = await invited.request.get(`/api/me?orgId=${orgId}`);
    expect(await me.json()).toMatchObject({ orgId, role: "scout" });
    const blocked = await invited.request.post("/api/organizations/invites", { headers, data: { orgId, email: "blocked@example.test", role: "admin" } });
    expect(blocked.status()).toBe(403);
    const foreign = await invited.request.get("/api/scouting/free-reports?orgId=6925a000-0000-4000-8000-000000000001");
    expect(foreign.status()).toBe(403);
  } finally {
    await Promise.allSettled([platform.close(), owner.close(), invited.close()]);
    if (orgId) {
      await pool.query("DELETE FROM admin_actions WHERE target_org_id=$1 AND EXISTS(SELECT 1 FROM organizations WHERE id=$1 AND name=$2)", [orgId, marker]);
      await pool.query("DELETE FROM organizations WHERE id=$1 AND name=$2", [orgId, marker]);
    }
    await pool.query("DELETE FROM users WHERE email=$1", [email]);
    await pool.end();
  }
});
