import { createKms, decryptSecret, encryptSecret } from "@vantage/billing";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

async function adminWork<T>(work: Parameters<typeof withRls<T>>[1]) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Authentication required");
  return withRls({ userId: session.user.id }, async (client) => {
    const result = await client.query("SELECT is_platform_admin() AS value");
    if (!result.rows[0]?.value) throw new Error("Platform administrator access required");
    return work(client);
  });
}
const errorResponse = (error: unknown) =>
  Response.json({ error: error instanceof Error ? error.message : "Request failed" }, { status: 403 });

export async function GET() {
  try {
    return Response.json(
      await adminWork(async (client) => {
        const [models, keys, plans, connectors] = await Promise.all([
          client.query(`SELECT id,display_name AS "displayName",provider,provider_model_id AS "providerModelId",
            input_price_per_million_usd AS "inputPrice",output_price_per_million_usd AS "outputPrice",
            capabilities,eligible_plans AS "eligiblePlans",payg_only AS "paygOnly",enabled,
            routing_weight AS "routingWeight" FROM model_catalog ORDER BY display_name`),
          client.query(`SELECT id,provider,label,last_used_at AS "lastUsedAt",disabled_at AS "disabledAt",
            created_at AS "createdAt" FROM platform_provider_keys ORDER BY created_at DESC`),
          client.query(`SELECT code,name,monthly_price_usd AS "monthlyPriceUsd",
            included_allowance_usd AS "includedAllowanceUsd",features,active FROM pricing_plans ORDER BY monthly_price_usd`),
          client.query(`SELECT id,kind,label,endpoint,workspace_id AS "workspaceId",
            model_mappings AS "modelMappings",metering_mode AS "meteringMode",enabled
            FROM platform_connectors ORDER BY created_at DESC`),
        ]);
        return { models: models.rows, keys: keys.rows, plans: plans.rows, connectors: connectors.rows };
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    await adminWork(async (client) => {
      const user = await client.query<{ id: string }>("SELECT current_app_user_id() AS id");
      if (body.action === "providerKey") {
        if (!body.provider || !body.label || !body.apiKey) throw new Error("Provider, label, and API key are required");
        const encrypted = await encryptSecret(String(body.apiKey), createKms());
        await client.query(
          `INSERT INTO platform_provider_keys(provider,label,key_ciphertext,key_nonce,key_auth_tag,
            encrypted_dek,kms_key_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [body.provider, body.label, encrypted.ciphertext, encrypted.nonce, encrypted.authTag,
            encrypted.encryptedDek, encrypted.kmsKeyId, user.rows[0]!.id],
        );
      } else if (body.action === "model") {
        await client.query(
          `UPDATE model_catalog SET provider=$2,provider_model_id=NULLIF($3,''),
            input_price_per_million_usd=$4,output_price_per_million_usd=$5,
            capabilities=$6::text[],eligible_plans=$7::text[],enabled=$8,
            routing_weight=$9,updated_at=now() WHERE id=$1`,
          [body.id, body.provider, body.providerModelId, body.inputPrice, body.outputPrice,
            body.capabilities, body.eligiblePlans, body.enabled, body.routingWeight],
        );
      } else if (body.action === "plan") {
        await client.query(
          `UPDATE pricing_plans SET included_allowance_usd=$2,features=$3::jsonb,active=$4,updated_at=now()
           WHERE code=$1`,
          [body.code, body.includedAllowanceUsd, JSON.stringify(body.features ?? []), body.active],
        );
      } else if (body.action === "disableKey") {
        await client.query("UPDATE platform_provider_keys SET disabled_at=now() WHERE id=$1", [body.id]);
      } else if (body.action === "testKey") {
        const key = await client.query<{
          provider: string; keyCiphertext: string; keyNonce: string; keyAuthTag: string;
          encryptedDek: string; kmsKeyId: string;
        }>(`SELECT provider,key_ciphertext AS "keyCiphertext",key_nonce AS "keyNonce",
          key_auth_tag AS "keyAuthTag",encrypted_dek AS "encryptedDek",kms_key_id AS "kmsKeyId"
          FROM platform_provider_keys WHERE id=$1 AND disabled_at IS NULL`, [body.id]);
        const row = key.rows[0];
        if (!row || !["openai","anthropic"].includes(row.provider)) throw new Error("Active OpenAI or Anthropic key required");
        const secret = await decryptSecret({
          ciphertext: row.keyCiphertext, nonce: row.keyNonce, authTag: row.keyAuthTag,
          encryptedDek: row.encryptedDek, kmsKeyId: row.kmsKeyId,
        }, createKms());
        const response = await fetch(
          row.provider === "openai" ? "https://api.openai.com/v1/models" : "https://api.anthropic.com/v1/models",
          {
            headers: row.provider === "openai"
              ? { authorization: `Bearer ${secret}` }
              : { "x-api-key": secret, "anthropic-version": "2023-06-01" },
            signal: AbortSignal.timeout(5_000),
          },
        );
        if (!response.ok) throw new Error(`Provider key test returned ${response.status}`);
        await client.query("UPDATE platform_provider_keys SET last_used_at=now() WHERE id=$1", [body.id]);
      } else if (body.action === "base44") {
        const encrypted = body.credential
          ? await encryptSecret(String(body.credential), createKms())
          : null;
        await client.query(
          `INSERT INTO platform_connectors(kind,label,endpoint,workspace_id,credential_ciphertext,
            credential_nonce,credential_auth_tag,encrypted_dek,kms_key_id,model_mappings,
            metering_mode,enabled,created_by)
           VALUES('base44',$1,NULLIF($2,''),NULLIF($3,''),$4,$5,$6,$7,$8,$9::jsonb,$10,false,$11)`,
          [body.label,body.endpoint,body.workspaceId,encrypted?.ciphertext ?? null,
            encrypted?.nonce ?? null,encrypted?.authTag ?? null,encrypted?.encryptedDek ?? null,
            encrypted?.kmsKeyId ?? null,JSON.stringify(body.modelMappings ?? {}),
            body.meteringMode ?? "unverified",user.rows[0]!.id],
        );
      } else throw new Error("Unknown configuration action");
    });
    return Response.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
