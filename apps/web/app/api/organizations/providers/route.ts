import { validateHostedProviderUrl } from "@vantage/agent";
import { createKms, decryptSecret, encryptSecret } from "@vantage/billing";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

async function context(orgId: string | undefined) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !orgId) throw new Error("Authentication and organization are required");
  return { session, orgId };
}
const fail = (error: unknown) =>
  Response.json({ error: error instanceof Error ? error.message : "Provider request failed" }, { status: 400 });

export async function GET(request: Request) {
  try {
    const orgId = new URL(request.url).searchParams.get("orgId") ?? undefined;
    const { session } = await context(orgId);
    const providers = await withRls({ userId: session.user.id, orgId }, async (client) =>
      (await client.query(`SELECT id,kind,label,base_url AS "baseUrl",local_relay AS "localRelay",
        model_mappings AS "modelMappings",enabled,last_tested_at AS "lastTestedAt",disabled_at AS "disabledAt"
        FROM org_provider_configs WHERE org_id=$1 ORDER BY created_at DESC`, [orgId])).rows,
    );
    return Response.json({ providers });
  } catch (error) { return fail(error); }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      orgId?: string; kind?: string; label?: string; baseUrl?: string; apiKey?: string;
      localRelay?: boolean; modelMappings?: Record<string, string>;
    };
    const { session, orgId } = await context(body.orgId);
    if (!body.kind || !body.label) throw new Error("Provider kind and label are required");
    const baseUrl = body.localRelay ? null : await validateHostedProviderUrl(body.baseUrl ?? "");
    const encrypted = body.apiKey ? await encryptSecret(body.apiKey, createKms()) : null;
    const id = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const admin = await client.query(`SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2 AND role IN ('owner','admin')`, [orgId, session.user.id]);
      if (!admin.rowCount) throw new Error("Organization administrator access required");
      return (await client.query<{ id: string }>(
        `INSERT INTO org_provider_configs(org_id,kind,label,base_url,local_relay,key_ciphertext,
          key_nonce,key_auth_tag,encrypted_dek,kms_key_id,model_mappings,enabled,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,true,$12) RETURNING id`,
        [orgId, body.kind, body.label, baseUrl, Boolean(body.localRelay), encrypted?.ciphertext ?? null,
          encrypted?.nonce ?? null, encrypted?.authTag ?? null, encrypted?.encryptedDek ?? null,
          encrypted?.kmsKeyId ?? null, JSON.stringify(body.modelMappings ?? {}), session.user.id],
      )).rows[0]!.id;
    });
    return Response.json({ id }, { status: 201 });
  } catch (error) { return fail(error); }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as { orgId?: string; id?: string; action?: "disable" | "test" };
    const { session, orgId } = await context(body.orgId);
    if (!body.id || !body.action) throw new Error("Invalid provider action");
    const result = await withRls({ userId: session.user.id, orgId }, async (client) => {
      if (body.action === "disable") {
        await client.query(`UPDATE org_provider_configs SET enabled=false,disabled_at=now(),updated_at=now()
          WHERE id=$1 AND org_id=$2`, [body.id, orgId]);
        return { success: true };
      }
      const config = await client.query<{
        baseUrl: string | null; localRelay: boolean; keyCiphertext: string | null;
        keyNonce: string | null; keyAuthTag: string | null; encryptedDek: string | null; kmsKeyId: string | null;
      }>(`SELECT base_url AS "baseUrl",local_relay AS "localRelay",key_ciphertext AS "keyCiphertext",
        key_nonce AS "keyNonce",key_auth_tag AS "keyAuthTag",encrypted_dek AS "encryptedDek",kms_key_id AS "kmsKeyId"
        FROM org_provider_configs WHERE id=$1 AND org_id=$2`, [body.id, orgId]);
      const row = config.rows[0];
      if (!row) throw new Error("Provider configuration not found");
      if (row.localRelay) return { success: false, relayRequired: true };
      const endpoint = await validateHostedProviderUrl(row.baseUrl!);
      const apiKey = row.keyCiphertext && row.keyNonce && row.keyAuthTag && row.encryptedDek && row.kmsKeyId
        ? await decryptSecret({ ciphertext: row.keyCiphertext, nonce: row.keyNonce, authTag: row.keyAuthTag,
            encryptedDek: row.encryptedDek, kmsKeyId: row.kmsKeyId }, createKms()) : null;
      const response = await fetch(`${endpoint}/models`, {
        headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error(`Provider test returned ${response.status}`);
      await client.query("UPDATE org_provider_configs SET last_tested_at=now() WHERE id=$1", [body.id]);
      return { success: true };
    });
    return Response.json(result);
  } catch (error) { return fail(error); }
}
