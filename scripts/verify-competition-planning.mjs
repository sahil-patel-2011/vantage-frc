// Only run inside an explicitly authorized disposable remote runner.
import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import pg from "pg";
import { chromium } from "playwright";

const connectionString = process.env.TEST_DATABASE_ADMIN_URL;
if (process.env.VANTAGE_REMOTE_TEST !== "1" || !connectionString) throw new Error("An authorized remote scratch database is required.");
const url = new URL(connectionString);
if (!["localhost", "127.0.0.1"].includes(url.hostname) || !/(?:^|_)test(?:_|$)/.test(url.pathname.slice(1)) || process.env.NODE_ENV === "production") throw new Error("Use only the remote runner's disposable loopback test database.");
const origin = process.env.VANTAGE_TEST_HTTP_ORIGIN;
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin ?? "")) throw new Error("HTTP acceptance must stay inside the remote runner.");
const secret = process.env.BETTER_AUTH_SECRET;
assert.ok(secret, "The scratch app's auth secret is required.");
const pool = new pg.Pool({ connectionString, max: 3 });
const org = randomUUID(), foreignOrg = randomUUID();
const users = [randomUUID(), randomUUID(), randomUUID()];
const proofDirectory = "/tmp/event-proof";
mkdirSync(proofDirectory, { recursive: true });
const cookies = [];
let browser;
const get = async (path, user = 0) => {
  const response = await fetch(`${origin}${path}`, { headers: { cookie: cookies[user] }, signal: AbortSignal.timeout(60000) });
  const body = await response.json();
  assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(body)}`);
  return body;
};
const post = async (body, user = 0, allowed = true) => {
  const response = await fetch(`${origin}/api/context/event`, { method: "POST", headers: { cookie: cookies[user], "content-type": "application/json", origin }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  const data = await response.json();
  assert.equal(response.ok, allowed, `${response.status}: ${JSON.stringify(data)}`);
  return data;
};
try {
  await pool.query("INSERT INTO organizations(id,name,slug,team_number) VALUES($1,'Planning acceptance',$2,9011),($3,'Other planning team',$4,9012)", [org, `planning-${org}`, foreignOrg, `planning-${foreignOrg}`]);
  const legal = /LEGAL_DOC_VERSION = "([^"]+)"/.exec(readFileSync("packages/core/src/legal.ts", "utf8"))?.[1];
  for (const [i, user] of users.entries()) {
    await pool.query("INSERT INTO users(id,email,name,email_verified) VALUES($1,$2,$3,true)", [user, `planning-${user}@example.test`, `Planning ${i}`]);
    await pool.query("INSERT INTO profiles(user_id,date_of_birth,onboarding_completed_at,onboarding_current_step,terms_accepted_at,privacy_accepted_at,terms_version,privacy_version,app_tour_seen_at) VALUES($1,'2000-01-01',now(),'complete',now(),now(),$2,$2,now())", [user, legal]);
    await pool.query("INSERT INTO memberships(org_id,user_id,role) VALUES($1,$2,$3)", [i === 2 ? foreignOrg : org, user, i === 1 ? "scout" : "owner"]);
    const token = randomUUID();
    await pool.query("INSERT INTO sessions(id,user_id,token,expires_at,auth_method,email_2fa_verified_at) VALUES($1,$2,$3,now()+interval '30 minutes','email_otp',now())", [randomUUID(), user, token]);
    cookies.push(`better-auth.session_token=${encodeURIComponent(`${token}.${createHmac("sha256", secret).update(token).digest("base64")}`)}`);
  }
  const directory = () => get(`/api/context/event?orgId=${org}&year=2027`);
  const saved = await post({ orgId: org, intent: "save", create: { name: "Shop scrimmage", year: 2027, city: "Atlanta", timeZone: "America/New_York" } });
  assert.ok(saved.eventKey);
  assert.equal((await directory()).activeEventKey, null, "Saving preparation does not activate");
  assert.equal((await get(`/api/team/calendar?orgId=${org}`)).events.length, 0, "Undated preparation does not invent a calendar date");
  const schedule = { startsAt: "2027-10-15T04:00:00.000Z", endsAt: "2027-10-18T04:00:00.000Z", timeZone: "America/New_York", autoActivate: true };
  const planned = await post({ orgId: org, intent: "schedule", eventKey: saved.eventKey, schedule });
  const repeated = await post({ orgId: org, intent: "schedule", eventKey: saved.eventKey, schedule });
  assert.equal(planned.calendarId, repeated.calendarId, "Both entry points and retries retain the same row");
  assert.equal((await directory()).activeEventKey, null, "Future competition does not activate early");
  const calendar = await get(`/api/team/calendar?orgId=${org}`, 1);
  assert.equal(calendar.events.filter(event => event.competitionEventKey === saved.eventKey).length, 1, "Ordinary members see exactly one shared entry");
  assert.equal(calendar.events.find(event => event.id === planned.calendarId).competitionAutoActivate, true);
  await post({ orgId: org, intent: "schedule", eventKey: saved.eventKey, schedule }, 1, false);
  await post({ orgId: org, intent: "schedule", eventKey: saved.eventKey, schedule: { ...schedule, timeZone: "Invalid/Zone" } }, 0, false);
  await post({ orgId: foreignOrg, intent: "schedule", eventKey: saved.eventKey, schedule }, 2, false);
  assert.equal((await get(`/api/context/event?orgId=${foreignOrg}&year=2027`, 2)).events.some(event => event.eventKey === saved.eventKey), false);
  // Move only this run's scratch row across the clock boundary. No production clock or records change.
  const clock = await pool.connect();
  try {
    await clock.query("BEGIN");
    await clock.query("SELECT set_config('app.user_id',$1,true),set_config('app.org_id',$2,true)", [users[0], org]);
    await clock.query("UPDATE subteam_calendar_events SET starts_at=now()-interval '1 hour',ends_at=now()+interval '1 day',created_at=now()-interval '2 hours' WHERE id=$1", [planned.calendarId]);
    await clock.query("COMMIT");
  } finally { clock.release(); }
  await get(`/api/me?orgId=${org}`, 1);
  assert.equal((await directory()).activeEventKey, saved.eventKey, "An ordinary member's first request activates the due team plan");
  const alternate = await post({ orgId: org, intent: "save", create: { name: "Practice alternative", year: 2027 } });
  await post({ orgId: org, intent: "activate", eventKey: alternate.eventKey });
  await get(`/api/me?orgId=${org}`, 1);
  assert.equal((await directory()).activeEventKey, alternate.eventKey, "A later manual choice wins");
  await post({ orgId: org, intent: "activate", eventKey: null });
  assert.equal((await directory()).activeEventKey, null, "Explicitly stopping tracking stays stopped");
  assert.equal((await get(`/api/team/calendar?orgId=${org}`, 1)).events.length, 1, "Stopping tracking preserves the calendar plan");
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await context.addCookies([{ name: "better-auth.session_token", value: cookies[0].split("=").slice(1).join("="), url: origin, httpOnly: true }]);
  await context.addInitScript(() => { localStorage.setItem("vantage.tour.v1", "done"); });
  const page = await context.newPage();
  await page.goto(`${origin}/competition?tab=command&pickEvent=1&orgId=${org}`);
  const dialog = page.getByRole("dialog", { name: "Competition events" });
  await dialog.getByRole("spinbutton", { name: "Competition season" }).fill("2027");
  await dialog.getByRole("searchbox", { name: "Search competitions" }).fill("Shop scrimmage");
  await dialog.getByRole("button", { name: /Shop scrimmage/ }).click();
  await page.screenshot({ path: `${proofDirectory}/authenticated-planning.png` });
  assert.ok(await dialog.getByRole("button", { name: "Save calendar dates", exact: true }).isVisible(), "The hosted planner reads the real persisted calendar association");
  const result = { status: "passed", checks: 14, authentication: "Real Better Auth sessions", persistence: "Disposable remote Postgres", browser: "Real API responses, no interceptions", scope: "No production writes, no model requests" };
  writeFileSync(`${proofDirectory}/acceptance.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser?.close();
  // Only this run's random fixture identities; no pre-existing data is touched.
  await pool.query("DELETE FROM organizations WHERE id=ANY($1::uuid[])", [[org, foreignOrg]]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
  await pool.end();
}
