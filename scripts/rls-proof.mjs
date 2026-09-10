#!/usr/bin/env node
// RLS proofs for the newest org-scoped tables, run as a NON-superuser login
// granted vantage_app. A superuser bypasses every policy, so a proof run as
// `postgres` proves nothing — this repo learned that the hard way.
//
// Usage (against a scratch database that has had every migration applied):
//   RLS_PROOF_SUPERUSER_URL=postgres://postgres:...@host/db \
//   RLS_PROOF_APP_URL=postgres://app_login:...@host/db \
//   node scripts/rls-proof.mjs
//
// `app_login` must be `LOGIN` with `GRANT vantage_app` and `ALTER ROLE ... SET
// ROLE vantage_app`, and must NOT be superuser or BYPASSRLS. The script
// refuses to run otherwise. It seeds two throwaway teams (slugs proof-a /
// proof-b) and removes them first if they exist.
import { createHash } from "node:crypto";
import { Client } from "pg";

const SU = process.env.RLS_PROOF_SUPERUSER_URL;
const APP = process.env.RLS_PROOF_APP_URL;
if (!SU || !APP) {
  console.error("Set RLS_PROOF_SUPERUSER_URL and RLS_PROOF_APP_URL (a scratch database, never production).");
  process.exit(2);
}

const results = [];
function pass(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

/** One statement inside a transaction with the GUCs withRls() sets. */
async function asUser(userId, orgId, sql, params = []) {
  const c = new Client(APP);
  await c.connect();
  try {
    await c.query("BEGIN");
    if (userId) await c.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    if (orgId) await c.query(`SELECT set_config('app.org_id', $1, true)`, [orgId]);
    const r = await c.query(sql, params);
    await c.query("COMMIT");
    return { rows: r.rows, rowCount: r.rowCount ?? 0, error: null };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    return { rows: [], rowCount: 0, error: e.message };
  } finally {
    await c.end();
  }
}

const su = new Client(SU);
await su.connect();

// Refuse to "prove" anything with a role that bypasses RLS.
{
  const probe = new Client(APP);
  await probe.connect();
  const who = (await probe.query(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`)).rows[0];
  const eff = (await probe.query(`SELECT current_user AS u, session_user AS s`)).rows[0];
  await probe.end();
  if (!who || who.rolsuper || who.rolbypassrls) {
    console.error(`RLS_PROOF_APP_URL connects as ${eff?.s} (superuser=${who?.rolsuper}, bypassrls=${who?.rolbypassrls}) — that cannot prove RLS.`);
    process.exit(2);
  }
  console.log(`app role: session ${eff.s}, effective ${eff.u}`);
}

// ---------------------------------------------------------------- seed
await su.query("DELETE FROM organizations WHERE slug IN ('proof-a','proof-b')");
await su.query("DELETE FROM users WHERE email LIKE '%@proof.test'");
const one = async (sql, p) => (await su.query(sql, p)).rows[0];
const orgA = (await one(`INSERT INTO organizations(name,slug,team_number) VALUES('Proof A','proof-a',6925) RETURNING id`)).id;
const orgB = (await one(`INSERT INTO organizations(name,slug,team_number) VALUES('Proof B','proof-b',254) RETURNING id`)).id;
const mk = async (email, name) => (await one(`INSERT INTO users(email,name,email_verified) VALUES($1,$2,true) RETURNING id`, [email, name])).id;
const owner = await mk("owner@proof.test", "Owner");
const student = await mk("student@proof.test", "Student");
const peer = await mk("peer@proof.test", "Peer");
const outsider = await mk("outsider@proof.test", "Outsider");
await su.query(
  `INSERT INTO memberships(org_id,user_id,role) VALUES ($1,$2,'owner'),($1,$3,'scout'),($1,$4,'scout'),($5,$6,'owner')`,
  [orgA, owner, student, peer, orgB, outsider],
);

const SHA = "a".repeat(64);
const H = (t) => createHash("sha256").update(t).digest("hex");
let r;

// ---------------------------------------------------------------- Drive (0641)
r = await asUser(student, orgA,
  `INSERT INTO drive_files(org_id,scope,owner_user_id,name,content_type,content_class,byte_size,sha256,storage_location,bytes,status,uploaded_by)
   VALUES($1,'personal',$2,'secret.pdf','application/pdf','document',3,$3,'db','\\x616263','ready',$2) RETURNING id`, [orgA, student, SHA]);
pass("drive: student creates a personal file", !r.error && r.rowCount === 1, r.error ?? "");
const personalId = r.rows[0]?.id;
r = await asUser(student, orgA, `SELECT id FROM drive_files WHERE id=$1`, [personalId]);
pass("drive: student reads their own personal file", r.rowCount === 1);
r = await asUser(peer, orgA, `SELECT id FROM drive_files WHERE id=$1`, [personalId]);
pass("drive: a peer cannot read it", r.rowCount === 0, `rows=${r.rowCount}`);
r = await asUser(owner, orgA, `SELECT id FROM drive_files WHERE id=$1`, [personalId]);
pass("drive: the OWNER cannot read it", r.rowCount === 0, `rows=${r.rowCount}`);
r = await asUser(owner, orgA, `UPDATE drive_files SET name='renamed' WHERE id=$1`, [personalId]);
pass("drive: the owner cannot modify it", r.rowCount === 0 || !!r.error);
r = await asUser(owner, orgA, `DELETE FROM drive_files WHERE id=$1`, [personalId]);
pass("drive: the owner cannot delete it", r.rowCount === 0 || !!r.error);
r = await asUser(student, orgA,
  `INSERT INTO drive_files(org_id,scope,owner_user_id,name,content_type,content_class,byte_size,sha256,storage_location,bytes,status,uploaded_by)
   VALUES($1,'personal',$2,'x','text/plain','document',1,$3,'db','\\x61','ready',$2)`, [orgB, student, SHA]);
pass("drive: a write carrying another org's org_id is refused", !!r.error);
r = await asUser(owner, orgA,
  `INSERT INTO drive_files(org_id,scope,name,content_type,content_class,byte_size,sha256,storage_location,bytes,status,uploaded_by)
   VALUES($1,'team','flyer.pdf','application/pdf','document',3,$2,'db','\\x616263','ready',$3) RETURNING id`, [orgA, SHA, owner]);
pass("drive: owner creates a team file", !r.error && r.rowCount === 1, r.error ?? "");
const teamFile = r.rows[0]?.id;
r = await asUser(student, orgA, `SELECT id FROM drive_files WHERE id=$1`, [teamFile]);
pass("drive: a member reads a team file", r.rowCount === 1);
r = await asUser(outsider, orgB, `SELECT id FROM drive_files WHERE id=$1`, [teamFile]);
pass("drive: another org cannot", r.rowCount === 0);
const token = "0123456789abcdef0123456789abcdef";
r = await asUser(owner, orgA, `INSERT INTO drive_shares(org_id,file_id,kind,token_hash,created_by) VALUES($1,$2,'link',$3,$4) RETURNING id`, [orgA, teamFile, H(token), owner]);
pass("drive: owner creates a link share", !r.error && r.rowCount === 1, r.error ?? "");
const shareId = r.rows[0]?.id;
const resolve = async (t) => (await asUser(null, null, `SELECT resolve_drive_share($1) AS s`, [t])).rows[0]?.s ?? null;
pass("drive: a live token resolves with no session", (await resolve(token)) !== null);
pass("drive: an unknown token resolves to null", (await resolve("f".repeat(32))) === null);
await su.query(`UPDATE drive_shares SET revoked_at=now() WHERE id=$1`, [shareId]);
pass("drive: a REVOKED token resolves to null", (await resolve(token)) === null);
await su.query(`UPDATE drive_shares SET revoked_at=NULL, expires_at=now()-interval '1 minute' WHERE id=$1`, [shareId]);
pass("drive: an EXPIRED token resolves to null", (await resolve(token)) === null);
r = await asUser(null, null, `SELECT id FROM drive_files WHERE id=$1`, [teamFile]);
pass("drive: with no session the table is invisible", r.rowCount === 0);
r = await asUser(owner, orgA, `INSERT INTO drive_shares(org_id,file_id,kind,token_hash,created_by) VALUES($1,$2,'link',$3,$4)`, [orgA, personalId, H("x".repeat(32)), owner]);
pass("drive: owner cannot share a student's personal file", !!r.error || r.rowCount === 0);

// ---------------------------------------------------------------- Outreach participants (0643)
const act = (await one(`INSERT INTO impact_activities(org_id,title,occurred_on,season_year,logged_by) VALUES($1,'Library demo','2026-02-01',2026,$2) RETURNING id`, [orgA, owner])).id;
r = await asUser(peer, orgA, `INSERT INTO impact_activity_participants(org_id,activity_id,user_id,minutes,added_by) VALUES($1,$2,$3,90,$4)`, [orgA, act, student, peer]);
pass("outreach: any member can credit a teammate", !r.error, r.error ?? "");
r = await asUser(peer, orgA, `INSERT INTO impact_activity_participants(org_id,activity_id,user_id,minutes,added_by) VALUES($1,$2,$3,90,$4)`, [orgA, act, outsider, peer]);
pass("outreach: a user from another org is refused", !!r.error);
r = await asUser(peer, orgA, `INSERT INTO impact_activity_participants(org_id,activity_id,user_id,minutes,added_by) VALUES($1,$2,$3,90,$4)`, [orgA, act, student, owner]);
pass("outreach: forging added_by is refused", !!r.error);
r = await asUser(outsider, orgB, `SELECT count(*)::int n FROM impact_activity_participants WHERE activity_id=$1`, [act]);
pass("outreach: another org sees zero rows", r.rows[0]?.n === 0);

// ---------------------------------------------------------------- Team dossier (0644)
r = await asUser(student, orgA, `INSERT INTO team_dossiers(org_id,team_number) VALUES($1,6925)`, [orgA]);
pass("dossier: a student cannot start a build", !!r.error);
r = await asUser(owner, orgA, `INSERT INTO team_dossiers(org_id,team_number) VALUES($1,254)`, [orgA]);
pass("dossier: the org's own team number is enforced", !!r.error);
r = await asUser(owner, orgA, `INSERT INTO team_dossiers(org_id,team_number) VALUES($1,6925)`, [orgA]);
pass("dossier: owner starts a build", !r.error, r.error ?? "");
r = await asUser(student, orgA, `SELECT status FROM team_dossiers WHERE org_id=$1`, [orgA]);
pass("dossier: a member can read it", r.rowCount === 1);
r = await asUser(outsider, orgB, `SELECT status FROM team_dossiers WHERE org_id=$1`, [orgA]);
pass("dossier: another org cannot", r.rowCount === 0);

// ---------------------------------------------------------------- Funding model (0651)
r = await asUser(owner, orgA, `UPDATE organizations SET funding_model = 'school_funded_no_sponsors' WHERE id = $1`, [orgA]);
pass("funding: owner can set the model", !r.error, r.error ?? "");
r = await asUser(outsider, orgB, `SELECT funding_model FROM organizations WHERE id = $1`, [orgA]);
pass("funding: another org cannot read it via this session", r.rowCount === 0 || r.rows[0]?.funding_model == null);

// ---------------------------------------------------------------- Relay nodes (0652)
r = await asUser(student, orgA,
  `INSERT INTO relay_nodes(org_id,paired_by,name,token_hash) VALUES($1,$2,'pi-chat',$3)`, [orgA, student, H("relay-student")]);
pass("relay: a student cannot pair a node", !!r.error);
r = await asUser(owner, orgA,
  `INSERT INTO relay_nodes(org_id,paired_by,name,token_hash) VALUES($1,$2,'shop-pi',$3) RETURNING id`, [orgA, owner, H("relay-owner")]);
pass("relay: owner pairs a node", !r.error && r.rowCount === 1, r.error ?? "");
const relayId = r.rows[0]?.id;
r = await asUser(student, orgA, `SELECT id FROM relay_nodes WHERE id = $1`, [relayId]);
pass("relay: a member can read it", r.rowCount === 1);
r = await asUser(outsider, orgB, `SELECT id FROM relay_nodes WHERE id = $1`, [relayId]);
pass("relay: another org cannot", r.rowCount === 0);

// ---------------------------------------------------------------- Video analysis jobs (0653)
r = await asUser(student, orgA,
  `INSERT INTO video_analysis_jobs(org_id,started_by,source_kind,source_ref) VALUES($1,$2,'youtube','https://youtu.be/x')`, [orgA, owner]);
pass("video: started_by cannot be forged", !!r.error);
r = await asUser(student, orgA,
  `INSERT INTO video_analysis_jobs(org_id,started_by,source_kind,source_ref) VALUES($1,$2,'youtube','https://youtu.be/x') RETURNING id`, [orgA, student]);
pass("video: a member can enqueue a job for themselves", !r.error && r.rowCount === 1, r.error ?? "");
const videoId = r.rows[0]?.id;
r = await asUser(outsider, orgB, `SELECT id FROM video_analysis_jobs WHERE id = $1`, [videoId]);
pass("video: another org cannot see the job", r.rowCount === 0);

// ---------------------------------------------------------------- Assembly manual (0642)
const cols = `org_id,started_by,onshape_url,document_id,workspace_id,element_id`;
const vals = `$1,$2,'https://cad.onshape.com/documents/d/w/w/e/e','d','w','e'`;
r = await asUser(student, orgA, `INSERT INTO assembly_manual_runs(${cols}) VALUES(${vals})`, [orgA, student]);
pass("manual: a student cannot start a run", !!r.error);
r = await asUser(owner, orgA, `INSERT INTO assembly_manual_runs(${cols}) VALUES(${vals})`, [orgA, student]);
pass("manual: started_by cannot be forged", !!r.error);
r = await asUser(owner, orgA, `INSERT INTO assembly_manual_runs(${cols}) VALUES(${vals}) RETURNING id`, [orgA, owner]);
pass("manual: owner starts a run", !r.error && r.rowCount === 1, r.error ?? "");
const runId = r.rows[0]?.id;
r = await asUser(owner, orgA, `INSERT INTO assembly_manual_steps(org_id,run_id,step_number) VALUES($1,$2,1)`, [orgA, runId]);
pass("manual: the app role has no write path to steps", !!r.error);
r = await asUser(outsider, orgB, `SELECT id FROM assembly_manual_runs WHERE id=$1`, [runId]);
pass("manual: another org cannot see the run", r.rowCount === 0);

await su.query("DELETE FROM organizations WHERE slug IN ('proof-a','proof-b')");
await su.query("DELETE FROM users WHERE email LIKE '%@proof.test'");
await su.end();
const failed = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - failed}/${results.length} proofs passed`);
process.exit(failed ? 1 : 0);
