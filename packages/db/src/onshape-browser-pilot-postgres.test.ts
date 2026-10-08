import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";

// Deliberately separate from the usual database URL: running this requires an
// explicitly named, isolated remote test destination with migration 0716 applied.
const url = process.env.ONSHAPE_PILOT_TEST_DATABASE_URL;
(url ? describe : describe.skip)("Onshape browser pilot device authorization in PostgreSQL", () => {
  it("enforces the pairing role boundary, current membership, platform, binding and sign-in policy", async () => {
    const target = new URL(url!);
    const approvedHost = process.env.ONSHAPE_PILOT_TEST_DATABASE_HOST;
    if (!approvedHost || target.hostname !== approvedHost ||
      ["localhost", "127.0.0.1", "0.0.0.0", "[::1]"].includes(target.hostname) ||
      !/(?:^|[_-])(test|ci)(?:[_-]|$)/i.test(target.pathname.slice(1))) {
      throw new Error("Explicitly authorized isolated remote test database required");
    }
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    const orgId = randomUUID(), userId = randomUUID(), otherOrgId = randomUUID(), deviceId = randomUUID(), sessionId = randomUUID();
    const tokenHash = createHash("sha256").update(randomBytes(32)).digest("hex");
    try {
      await client.query("BEGIN");
      // Do not touch an existing team, even in a test database.
      expect((await client.query("SELECT 1 FROM organizations WHERE team_number=6925")).rows).toHaveLength(0);
      await client.query("INSERT INTO users(id,email,name,email_verified) VALUES($1,$2,'Pilot fixture',true)", [userId, `${userId}@example.test`]);
      await client.query("INSERT INTO sessions(id,user_id,token,expires_at,auth_method) VALUES($1,$2,$3,now()+interval '1 hour','google')", [sessionId, userId, randomUUID()]);
      await client.query("INSERT INTO organizations(id,name,slug,team_number) VALUES($1,'Pilot fixture',$1::text,6925),($2,'Other fixture',$2::text,NULL)", [orgId, otherOrgId]);
      await client.query("INSERT INTO memberships(org_id,user_id,role) VALUES($1,$2,'scout')", [orgId, userId]);
      await client.query("INSERT INTO cad_relay_devices(id,org_id,user_id,machine_name,platform,token_hash,scopes) VALUES($1,$2,$3,'Pilot test','onshape',$4,ARRAY['cad.jobs.monitor'])", [deviceId, orgId, userId, tokenHash]);
      const probe = async (boundOrg = orgId, hash = tokenHash, email2faEnforced = false) => {
        await client.query("SET LOCAL ROLE vantage_pairing");
        const result = await client.query("SELECT * FROM check_onshape_browser_pilot_device($1,$2::uuid,$3)", [hash, boundOrg, email2faEnforced]);
        await client.query("RESET ROLE");
        return result.rows[0];
      };
      const enroll = async (approvedSession = sessionId, actor = userId, email2faEnforced = false) => {
        await client.query("SET LOCAL ROLE vantage_app");
        await client.query("SELECT set_config('app.user_id',$1,true),set_config('app.org_id',$2,true)", [actor, orgId]);
        const result = await client.query("SELECT enroll_onshape_browser_pilot_device($1,$2,$3,NULL,$4) AS approved", [deviceId, approvedSession, orgId, email2faEnforced]);
        await client.query("RESET ROLE");
        return result.rows[0].approved;
      };
      // An old pairing alone is insufficient, even under a permissive policy.
      expect(await probe()).toMatchObject({ allowed: false, reason: "team_sign_in_required" });
      expect(await enroll(randomUUID())).toBe(false);
      expect(await enroll(sessionId, randomUUID())).toBe(false);
      expect(await enroll()).toBe(true);
      // Default Google/email policy is accepted using the actual approving session.
      expect(await probe()).toEqual({ allowed: true, status: "eligible", reason: "pilot_member" });
      // Enabling email 2FA after approval must stop the already-paired device.
      expect(await probe(orgId, tokenHash, true)).toMatchObject({ allowed: false, reason: "team_sign_in_required" });
      expect(await enroll(sessionId, userId, true)).toBe(false);
      await client.query("UPDATE sessions SET email_2fa_verified_at=now() WHERE id=$1", [sessionId]);
      expect(await probe(orgId, tokenHash, true)).toMatchObject({ allowed: true });
      expect(await enroll(sessionId, userId, true)).toBe(true);
      expect(await probe(otherOrgId)).toMatchObject({ allowed: false, reason: "pilot_membership_required" });
      expect(await probe(orgId, "0".repeat(64))).toMatchObject({ allowed: false, reason: "device_invalid" });
      await client.query("UPDATE org_auth_policies SET mfa_policy='required' WHERE org_id=$1", [orgId]);
      expect(await probe()).toMatchObject({ allowed: false, reason: "team_sign_in_required" });
      await client.query("INSERT INTO user_mfa_enrollments(user_id,encrypted_secret,confirmed_at) VALUES($1,'fixture-not-a-real-secret',now())", [userId]);
      await client.query("INSERT INTO mfa_step_up_sessions(user_id,org_id,session_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')", [userId, orgId, sessionId]);
      expect(await probe()).toMatchObject({ allowed: true });
      await client.query("UPDATE mfa_step_up_sessions SET expires_at=now()-interval '1 second' WHERE session_id=$1", [sessionId]);
      expect(await probe()).toMatchObject({ allowed: false, reason: "team_sign_in_required" });
      await client.query("UPDATE org_auth_policies SET mfa_policy='off',allow_google=false WHERE org_id=$1", [orgId]);
      expect(await probe()).toMatchObject({ allowed: false, reason: "team_sign_in_required" });
      await client.query("UPDATE org_auth_policies SET allow_google=true WHERE org_id=$1", [orgId]);
      await client.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE id=$1", [sessionId]);
      expect(await probe()).toMatchObject({ allowed: false, reason: "team_sign_in_required" });
      await client.query("UPDATE sessions SET expires_at=now()+interval '1 hour' WHERE id=$1", [sessionId]);
      await client.query("DELETE FROM memberships WHERE org_id=$1 AND user_id=$2", [orgId, userId]);
      expect(await probe()).toMatchObject({ allowed: false, reason: "pilot_membership_required" });
      await client.query("INSERT INTO memberships(org_id,user_id,role) VALUES($1,$2,'viewer')", [orgId, userId]);
      expect(await probe()).toMatchObject({ allowed: true });
      await client.query("UPDATE cad_relay_devices SET platform='fusion360' WHERE id=$1", [deviceId]);
      expect(await probe()).toMatchObject({ allowed: false, reason: "device_invalid" });
      await client.query("UPDATE cad_relay_devices SET platform='onshape',scopes='{}' WHERE id=$1", [deviceId]);
      expect(await probe()).toMatchObject({ allowed: false, reason: "device_invalid" });
      await client.query("UPDATE cad_relay_devices SET scopes=ARRAY['cad.jobs.monitor'],revoked_at=now() WHERE id=$1", [deviceId]);
      expect(await probe()).toMatchObject({ allowed: false, reason: "device_invalid" });
      await client.query("UPDATE cad_relay_devices SET revoked_at=NULL WHERE id=$1", [deviceId]);
      await client.query("DELETE FROM sessions WHERE id=$1", [sessionId]);
      expect(await probe()).toMatchObject({ allowed: false, reason: "team_sign_in_required" });
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  });
});
