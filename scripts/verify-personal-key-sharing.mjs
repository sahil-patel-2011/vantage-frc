// Run only in an explicitly authorized, disposable remote test environment.
// Never against the laptop or a hosted production database.
import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";

const connectionString = process.env.TEST_DATABASE_ADMIN_URL;
if (process.env.VANTAGE_REMOTE_TEST !== "1" || !connectionString) throw new Error("An authorized remote scratch database is required.");
const url = new URL(connectionString);
if (!["127.0.0.1", "localhost"].includes(url.hostname) || !/(?:^|_)test(?:_|$)/.test(url.pathname.slice(1)) || process.env.NODE_ENV === "production") throw new Error("Only a disposable loopback test database inside the remote runner is allowed.");
const pool = new pg.Pool({ connectionString, max: 3, connectionTimeoutMillis: 10_000 });
const org = randomUUID(), otherOrg = randomUUID(), key = randomUUID();
const users = Array.from({ length: 102 }, () => randomUUID());
const owner = users[0], recipient = users[1], excluded = users[2], outsider = users[101];
const httpTarget = process.env.VANTAGE_TEST_HTTP_ORIGIN;
if (httpTarget && !/^http:\/\/127\.0\.0\.1:\d+$/.test(httpTarget)) throw new Error("HTTP acceptance must stay inside the disposable remote runner.");
async function asUser(userId, orgId, work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE vantage_app");
    await client.query("SELECT set_config('app.user_id',$1,true),set_config('app.org_id',$2,true)", [userId, orgId]);
    const result = await work(client);
    await client.query("COMMIT"); return result;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
const shared = (userId, orgId = org) => asUser(userId, orgId, client => client.query("SELECT id FROM shared_member_llm_keys($1::uuid)", [org]).then(result => result.rows.map(row => row.id)));
try {
  await pool.query("INSERT INTO organizations(id,name,slug,team_number) VALUES($1,'Sharing test',$2,9001),($3,'Other test',$4,9002)", [org, `sharing-${org}`, otherOrg, `sharing-${otherOrg}`]);
  for (const [index, userId] of users.entries()) {
    await pool.query("INSERT INTO users(id,email,name,email_verified) VALUES($1,$2,$3,true)", [userId, `sharing-${userId}@example.test`, `Test member ${index}`]);
    const legalVersion = /LEGAL_DOC_VERSION = "([^"]+)"/.exec(readFileSync("packages/core/src/legal.ts", "utf8"))?.[1];
    await pool.query("INSERT INTO profiles(user_id,date_of_birth,onboarding_completed_at,onboarding_current_step,terms_accepted_at,privacy_accepted_at,terms_version,privacy_version) VALUES($1,'2000-01-01',now(),'complete',now(),now(),$2,$2)", [userId, legalVersion]);
    await pool.query("INSERT INTO memberships(org_id,user_id,role) VALUES($1,$2,$3)", [userId === outsider ? otherOrg : org, userId, userId === owner || userId === outsider ? "owner" : "scout"]);
  }
  await asUser(owner, org, client => client.query("INSERT INTO member_llm_keys(id,org_id,user_id,provider,label,key_ciphertext,key_nonce,key_auth_tag,encrypted_dek,kms_key_id) VALUES($1,$2,$3,'google','Scratch key','not-a-real-secret','n','t','d','test')", [key, org, owner]));
  assert.deepEqual(await shared(recipient), [], "Personal by default");
  const setSharing = (scope, ids = []) => asUser(owner, org, client => client.query("UPDATE member_llm_keys SET share_scope=$2,share_user_ids=$3::uuid[] WHERE id=$1", [key, scope, ids]));
  await setSharing("selected", [recipient]);
  assert.deepEqual(await shared(recipient), [key]);
  assert.deepEqual(await shared(excluded), []);
  assert.deepEqual(await shared(outsider, otherOrg), []);
  assert.deepEqual(await shared(recipient, otherOrg), [], "Tenant context cannot be substituted");
  assert.equal(await asUser(recipient, org, client => client.query("SELECT id FROM member_llm_keys WHERE id=$1", [key]).then(result => result.rowCount)), 0, "Recipients cannot select another person's secret row");
  assert.equal(await asUser(recipient, org, client => client.query("UPDATE member_llm_keys SET label='unauthorized' WHERE id=$1", [key]).then(result => result.rowCount)), 0, "Recipients cannot edit the key");
  await assert.rejects(setSharing("selected", [outsider]), /belong to this team/);
  await setSharing("team");
  assert.deepEqual(await shared(excluded), [key]);
  const started = performance.now();
  const times = await Promise.all(users.slice(1, 101).map(async userId => {
    const at = performance.now(); assert.deepEqual(await shared(userId), [key]); return performance.now() - at;
  }));
  times.sort((a,b) => a-b);
  const metrics = { requests: times.length, errors: 0, poolConnections: 3, elapsedMs: Math.round(performance.now()-started), p95Ms: Math.round(times[94]), maxMs: Math.round(times.at(-1)) };
  assert.ok(metrics.p95Ms < 2000, `RLS read p95 exceeded 2s: ${JSON.stringify(metrics)}`);
  let httpMetrics = null;
  if (httpTarget) {
    const secret = process.env.BETTER_AUTH_SECRET;
    assert.ok(secret, "The scratch server's auth secret is required for its disposable test sessions.");
    const sessions = [];
    for (const userId of users.slice(1, 101)) {
      const token = randomUUID();
      await pool.query("INSERT INTO sessions(id,user_id,token,expires_at,auth_method,email_2fa_verified_at) VALUES($1,$2,$3,now()+interval '30 minutes','email_otp',now())", [randomUUID(), userId, token]);
      const signed = encodeURIComponent(`${token}.${createHmac("sha256", secret).update(token).digest("base64")}`);
      sessions.push({ userId, cookie: `better-auth.session_token=${signed}` });
    }
    const paths = ["/api/me", "/api/agent", "/api/team/calendar"];
    for (const path of paths) {
      const warm = await fetch(`${httpTarget}${path}?orgId=${org}`, { headers: { cookie: sessions[0].cookie }, signal: AbortSignal.timeout(60_000) });
      assert.ok(warm.ok, `${path} warm request failed: ${warm.status} ${await warm.text()}`);
    }
    const at = performance.now();
    const requests = await Promise.all(sessions.map(async (session, index) => {
      const start = performance.now(), path = paths[index % paths.length];
      try {
        const response = await fetch(`${httpTarget}${path}?orgId=${org}`, { headers: { cookie: session.cookie }, signal: AbortSignal.timeout(15_000) });
        const data = await response.json();
        return { ms: performance.now()-start, ok: response.ok && (path !== "/api/me" || data.userId === session.userId), status: response.status, path };
      } catch { return { ms: performance.now()-start, ok: false, status: 0, path }; }
    }));
    const sorted = requests.map(r => r.ms).sort((a,b) => a-b);
    httpMetrics = { users: sessions.length, errors: requests.filter(r => !r.ok), elapsedMs: Math.round(performance.now()-at), p95Ms: Math.round(sorted[94]), maxMs: Math.round(sorted.at(-1)) };
    console.log(JSON.stringify({ authenticatedHttp: httpMetrics }));
    assert.equal(httpMetrics.errors.length, 0, "Every user must receive their authorized data.");
    assert.ok(httpMetrics.p95Ms < 4000, "Authenticated mixed-read p95 exceeded 4 seconds.");
  }
  await asUser(owner, org, client => client.query("UPDATE member_llm_keys SET enabled=false WHERE id=$1", [key]));
  assert.deepEqual(await shared(recipient), []);
  await asUser(owner, org, client => client.query("UPDATE member_llm_keys SET enabled=true WHERE id=$1", [key]));
  await pool.query("DELETE FROM memberships WHERE org_id=$1 AND user_id=$2", [org, owner]);
  assert.deepEqual(await shared(recipient), [], "Departed owners cannot keep authorizing shared use");
  console.log(JSON.stringify({ sharing: "passed", concurrentRlsReads: metrics, authenticatedHttp: httpMetrics, scope: "Disposable remote Postgres and scratch app; no model/provider or production load" }));
} finally {
  // These UUIDs were generated by this run. No existing team or user is touched.
  await pool.query("DELETE FROM organizations WHERE id=ANY($1::uuid[])", [[org, otherOrg]]).catch(() => undefined);
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]).catch(() => undefined);
  await pool.end();
}
