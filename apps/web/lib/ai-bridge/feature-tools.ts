import { createHash } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { createVantageToolRegistry, isProposedActionOutput } from "@vantage/agent";
import { isToolAllowed, loadOrgAiPolicy } from "@vantage/billing";
import { withRls } from "@vantage/db";
import { PERSONAL_FEATURE_TOOLS, validateFeatureToolInput } from "../../../../packages/connector/src/feature-tools";
import { getAiBridgePool } from "./pool";

export class PersonalToolError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function personalDeviceIdentity(token: string) {
  const hash = createHash("sha256").update(token).digest("hex");
  const row = (await getAiBridgePool().query<{ id: string; org_id: string; paired_by: string }>(
    `SELECT id,org_id,paired_by FROM ai_bridge_devices WHERE token_hash=$1 AND revoked_at IS NULL`, [hash],
  )).rows[0];
  if (!row?.paired_by) throw new PersonalToolError("Your personal connection is invalid or revoked. Pair it again.", 401);
  return { deviceId: row.id, orgId: row.org_id, userId: row.paired_by };
}

/** Recheck membership, age and the device under the user's RLS session on every invocation. */
export async function withPersonalDevice<T>(identity: Awaited<ReturnType<typeof personalDeviceIdentity>>, work: Parameters<typeof withRls<T>>[1]) {
  return withRls(identity, async (client) => {
    const device = await client.query(`SELECT id FROM ai_bridge_devices
      WHERE id=$1::uuid AND paired_by=$2::uuid AND org_id=$3::uuid AND revoked_at IS NULL FOR SHARE`,
      [identity.deviceId, identity.userId, identity.orgId]);
    const eligible = await client.query<{ allowed: boolean }>(`SELECT account_age_eligible($1::uuid)
      AND EXISTS(SELECT 1 FROM memberships WHERE user_id=$1::uuid AND org_id=$2::uuid) AS allowed`, [identity.userId, identity.orgId]);
    if (!device.rows.length || eligible.rows[0]?.allowed !== true) throw new PersonalToolError("This personal connection no longer has team access.", 403);
    return work(client);
  });
}

async function requireTeamAi(client: PoolClient, orgId: string) {
  const disabled = (await client.query<{ disabled: boolean }>(`SELECT
    EXISTS(SELECT 1 FROM org_billing WHERE org_id=$1::uuid AND kill_switch)
    OR EXISTS(SELECT 1 FROM org_usage_policies WHERE org_id=$1::uuid AND kill_switch) AS disabled`, [orgId])).rows[0]?.disabled;
  if (disabled) throw new PersonalToolError("Your team has disabled AI access.", 403);
}

export async function listPersonalTools(identity: Awaited<ReturnType<typeof personalDeviceIdentity>>) {
  return withPersonalDevice(identity, async (client) => {
    await requireTeamAi(client, identity.orgId);
    const policy = await loadOrgAiPolicy(client, identity.orgId);
    return PERSONAL_FEATURE_TOOLS.filter((tool) => isToolAllowed(policy, tool.service)).map(({ service: _service, mutation: _mutation, ...definition }) => definition);
  });
}

export async function invokePersonalTool(identity: Awaited<ReturnType<typeof personalDeviceIdentity>>, name: string, input: unknown) {
  let parsed: ReturnType<typeof validateFeatureToolInput>;
  try { parsed = validateFeatureToolInput(name, input); }
  catch (error) { throw new PersonalToolError(error instanceof Error ? error.message : "Invalid tool input.", 400); }
  return withPersonalDevice(identity, async (client) => {
    await requireTeamAi(client, identity.orgId);
    const policy = await loadOrgAiPolicy(client, identity.orgId);
    if (!isToolAllowed(policy, parsed.tool.service)) throw new PersonalToolError("Your team has disabled this AI tool.", 403);
    const active = (await client.query<{ active_event_key: string | null }>(`SELECT active_event_key FROM org_active_context WHERE org_id=$1`, [identity.orgId])).rows[0]?.active_event_key ?? null;
    const result = await createVantageToolRegistry({ writeMode: "propose" }).invoke(parsed.tool.service, { client, ...identity, activeEventKey: active }, parsed.input);
    if (parsed.tool.mutation && !isProposedActionOutput(result)) throw new PersonalToolError("The action could not be proposed. Nothing was confirmed.", 503);
    if (isProposedActionOutput(result) && (!result.proposalId || result.status !== "proposed")) throw new PersonalToolError(result.message, 503);
    return result;
  });
}
