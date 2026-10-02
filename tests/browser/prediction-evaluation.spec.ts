import { expect, test } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { signInAs } from "./session";

test("model evaluation grades pre-match records and rejects hindsight and other teams", async ({ context }) => {
  expect(await signInAs(context, "owner")).toBe(true);
  const orgId = "6925a000-0000-4000-8000-000000000001";
  const ownerId = "6925e2e0-0000-4000-8000-000000000001";
  const database = new URL(process.env.DATABASE_ADMIN_URL!);
  expect(["127.0.0.1", "localhost"]).toContain(database.hostname);
  expect(database.pathname).toMatch(/(?:^|[_/])(?:test|ci)(?:[_/]|$)|vantage_ci/);
  const pool = new Pool({ connectionString: database.href, ssl: false });
  const version = `evaluation-test-${randomUUID()}`;
  const keys: string[] = [];
  try {
    const event = (await pool.query("SELECT active_event_key FROM org_active_context WHERE org_id=$1", [orgId])).rows[0].active_event_key;
    for (let index = 0; index < 3; index++) {
      const key = `${event}_evaluation_${randomUUID()}`; keys.push(key);
      await pool.query("INSERT INTO matches_ref(match_key,event_key,comp_level,set_number,match_number,red_alliance,blue_alliance,actual_time,winning_alliance) VALUES($1,$2,'qm',1,99870+$3,$4::jsonb,$5::jsonb,now()-interval '1 hour',$6)", [key, event, index,
        JSON.stringify({ teamKeys: ["frc6925", "frc254", "frc1678"], score: 100 }), JSON.stringify({ teamKeys: ["frc1323", "frc2056", "frc999"], score: index === 1 ? 120 : 90 }), index === 1 ? "blue" : "red"]);
      await pool.query("INSERT INTO predictions(org_id,match_key,model_version,p_red,p_blue,confidence_low,confidence_high,created_by,scored_at) VALUES($1,$2,$3,.9,.1,.7,.99,$4,now()-($5::int*interval '1 hour'))", [orgId, key, version, ownerId, index === 2 ? 0 : 2]);
    }
    const response = await context.request.get(`/api/strategy/evaluation?orgId=${orgId}`);
    expect(response.ok()).toBe(true);
    const model = (await response.json()).models.find((row: { modelVersion: string }) => row.modelVersion === version);
    expect(model).toMatchObject({ matches: 2, accuracy: .5 });
    expect(model.logLoss).toBeCloseTo(-Math.log(.09)/2);
    expect(model.brier).toBeCloseTo(.41);
    expect((await context.request.get(`/api/strategy/evaluation?orgId=${randomUUID()}`)).status()).toBe(403);
  } finally {
    await pool.query("DELETE FROM matches_ref WHERE match_key=ANY($1::text[])", [keys]);
    await pool.end();
  }
});
