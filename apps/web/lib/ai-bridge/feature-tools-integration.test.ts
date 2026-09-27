import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.TEST_DATABASE_ADMIN_URL;
const suite = url ? describe.sequential : describe.skip;
suite("personal feature tools against PostgreSQL", () => {
  const ids = Array.from({ length: 6 }, () => randomUUID());
  const [alice, bob, orgA, orgB, deviceA, deviceB] = ids as [string, string, string, string, string, string];
  const tokenA = randomUUID().replaceAll("-", "");
  const tokenB = randomUUID().replaceAll("-", "");
  const hash = (token: string) => createHash("sha256").update(token).digest("hex");
  const pool = url ? new pg.Pool({ connectionString: url }) : null;
  let tools: typeof import("./feature-tools");
  beforeAll(async () => {
    const target = new URL(url!);
    if (!["localhost", "127.0.0.1"].includes(target.hostname) || !target.pathname.includes("test")) throw new Error("Dedicated local test database required.");
    process.env.DATABASE_URL = url;
    const pairingUrl = new URL(url!); pairingUrl.searchParams.set("options", "-c role=vantage_pairing");
    process.env.DATABASE_AI_BRIDGE_URL = pairingUrl.toString();
    tools = await import("./feature-tools");
    await pool!.query("INSERT INTO users(id,email,name) VALUES($1,$2,'Alice'),($3,$4,'Bob')", [alice, `${alice}@example.test`, bob, `${bob}@example.test`]);
    await pool!.query("INSERT INTO profiles(user_id,date_of_birth) VALUES($1,'2000-01-01'),($2,'2000-01-01')", [alice, bob]);
    await pool!.query("INSERT INTO organizations(id,name,slug) VALUES($1::uuid,'Personal A',$1::text),($2::uuid,'Personal B',$2::text)", [orgA, orgB]);
    await pool!.query("INSERT INTO memberships(org_id,user_id,role) VALUES($1,$2,'owner'),($3,$4,'owner')", [orgA, alice, orgB, bob]);
    await pool!.query("INSERT INTO ai_bridge_devices(id,org_id,paired_by,name,token_hash) VALUES($1,$2,$3,'A',$4),($5,$6,$7,'B',$8)", [deviceA, orgA, alice, hash(tokenA), deviceB, orgB, bob, hash(tokenB)]);
    await pool!.query("INSERT INTO inventory_items(org_id,name,quantity,created_by) VALUES($1,'Alice bolts',10,$3),($2,'Bob private stock',20,$4)", [orgA, orgB, alice, bob]);
  });
  afterAll(async () => {
    await pool?.query("DELETE FROM organizations WHERE id=ANY($1::uuid[])", [[orgA, orgB]]);
    await pool?.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [[alice, bob]]);
    await pool?.end();
    if (tools) {
      const { requestPool } = await import("@vantage/db"); await requestPool.end();
      const { getAiBridgePool } = await import("./pool"); await getAiBridgePool().end();
    }
  });
  it("reads only the paired team's inventory and stores unconfirmed actions under the paired person", async () => {
    const actor = await tools.personalDeviceIdentity(tokenA);
    expect(actor).toEqual({ deviceId: deviceA, orgId: orgA, userId: alice });
    const stock = await tools.invokePersonalTool(actor, "vantage_inventory_availability", {}) as { items: Array<{ name: string }> };
    expect(stock.items.map((item) => item.name)).toEqual(["Alice bolts"]);
    await expect(tools.invokePersonalTool(actor, "vantage_inventory_availability", { orgId: orgB })).rejects.toThrow(/Unsupported/);
    const proposal = await tools.invokePersonalTool(actor, "vantage_cad_create_brief", { request: "Fix intake", title: "Intake repair" }) as { status: string; proposalId: string; requiresConfirmation: boolean };
    expect(proposal).toMatchObject({ status: "proposed", requiresConfirmation: true });
    expect((await pool!.query("SELECT org_id,proposed_by,status FROM ai_action_proposals WHERE id=$1", [proposal.proposalId])).rows).toEqual([{ org_id: orgA, proposed_by: alice, status: "pending" }]);
    expect((await pool!.query("SELECT id FROM cad_jobs WHERE org_id=$1", [orgA])).rows).toEqual([]);
    const other = await tools.personalDeviceIdentity(tokenB);
    const otherStock = await tools.invokePersonalTool(other, "vantage_inventory_availability", {}) as { items: Array<{ name: string }> };
    expect(otherStock.items.map((item) => item.name)).toEqual(["Bob private stock"]);
  });
  it("rejects revocation, membership loss and an ineligible existing account on every call", async () => {
    const actor = await tools.personalDeviceIdentity(tokenA);
    await pool!.query("INSERT INTO org_billing(org_id,period_start,period_end,kill_switch) VALUES($1,now(),now()+interval '1 month',true)", [orgA]);
    await expect(tools.listPersonalTools(actor)).rejects.toThrow(/disabled AI/);
    await expect(tools.invokePersonalTool(actor, "vantage_inventory_availability", {})).rejects.toThrow(/disabled AI/);
    await pool!.query("UPDATE org_billing SET kill_switch=false WHERE org_id=$1", [orgA]);
    await pool!.query("UPDATE ai_bridge_devices SET revoked_at=now() WHERE id=$1", [deviceA]);
    await expect(tools.personalDeviceIdentity(tokenA)).rejects.toThrow(/revoked/);
    await expect(tools.invokePersonalTool(actor, "vantage_cad_briefs", {})).rejects.toThrow(/access/);
    await pool!.query("UPDATE ai_bridge_devices SET revoked_at=NULL WHERE id=$1", [deviceA]);
    await pool!.query("DELETE FROM memberships WHERE user_id=$1 AND org_id=$2", [alice, orgA]);
    await expect(tools.invokePersonalTool(actor, "vantage_cad_briefs", {})).rejects.toThrow(/access/);
    await pool!.query("INSERT INTO memberships(org_id,user_id,role) VALUES($1,$2,'owner')", [orgA, alice]);
    await pool!.query("INSERT INTO profiles(user_id,date_of_birth) VALUES($1,CURRENT_DATE-interval '12 years') ON CONFLICT(user_id) DO UPDATE SET date_of_birth=EXCLUDED.date_of_birth", [alice]);
    await expect(tools.invokePersonalTool(actor, "vantage_cad_briefs", {})).rejects.toThrow(/access/);
  });
});
