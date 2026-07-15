import { createKms, decryptSecret, encryptSecret } from "@vantage/billing";
import { assertPlatformPrivilegeMfa,auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { HttpBase44BridgeTransport } from "@vantage/agent";
import { headers } from "next/headers";

async function adminWork<T>(work: Parameters<typeof withRls<T>>[1],requireMfa=false) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Authentication required");
  return withRls({ userId: session.user.id }, async (client) => {
    const result = await client.query("SELECT is_platform_admin() AS value");
    if (!result.rows[0]?.value) throw new Error("Platform administrator access required");
    if(requireMfa)await assertPlatformPrivilegeMfa(client,{userId:session.user.id,sessionId:session.session.id});
    return work(client);
  });
}
const errorResponse = (error: unknown) =>
  Response.json({ error: error instanceof Error ? error.message : "Request failed" }, { status: 403 });

export async function GET() {
  try {
    return Response.json(
      await adminWork(async (client) => {
        const [models, keys, plans, connectors, freePolicy] = await Promise.all([
          client.query(`SELECT id,display_name AS "displayName",provider,provider_model_id AS "providerModelId",
            input_price_per_million_usd AS "inputPrice",output_price_per_million_usd AS "outputPrice",
            capabilities,eligible_plans AS "eligiblePlans",payg_only AS "paygOnly",enabled,
            routing_weight AS "routingWeight",funding_mode AS "fundingMode",
            commercial_use_approved AS "commercialUseApproved",
            commercial_approval_source AS "commercialApprovalSource",
            commercial_approval_reviewed_at AS "commercialApprovalReviewedAt",
            provider_rate_limit_rpm AS "providerRateLimitRpm",
            provider_concurrency_limit AS "providerConcurrencyLimit",
            sponsored_enabled AS "sponsoredEnabled" FROM model_catalog ORDER BY display_name`),
          client.query(`SELECT id,provider,label,last_used_at AS "lastUsedAt",disabled_at AS "disabledAt",
            created_at AS "createdAt" FROM platform_provider_keys ORDER BY created_at DESC`),
          client.query(`SELECT code,name,monthly_price_usd AS "monthlyPriceUsd",
            included_allowance_usd AS "includedAllowanceUsd",features,active FROM pricing_plans ORDER BY monthly_price_usd`),
          client.query(`SELECT id,kind,label,app_id AS "appId",bridge_url AS "bridgeUrl",
            model_mappings AS "modelMappings",metering_mode AS "meteringMode",enabled,feature_flag_enabled AS "featureFlagEnabled",
            approval_reference AS "approvalReference",approval_date AS "approvalDate",approval_acknowledged AS "approvalAcknowledged",
            health_verified_at AS "healthVerifiedAt",daily_quota AS "dailyQuota"
            FROM platform_connectors ORDER BY created_at DESC`),
          client.query(`SELECT id,enabled,sponsored_model_id AS "sponsoredModelId",
            monthly_allowance_usd AS "monthlyAllowanceUsd",
            org_daily_request_limit AS "orgDailyRequestLimit",
            user_daily_request_limit AS "userDailyRequestLimit",
            ip_daily_request_limit AS "ipDailyRequestLimit",concurrency_limit AS "concurrencyLimit",
            priority,require_verified_email AS "requireVerifiedEmail",
            require_closed_team_membership AS "requireClosedTeamMembership"
            FROM platform_free_ai_policy WHERE id='default'`),
        ]);
        return { models: models.rows, keys: keys.rows, plans: plans.rows, connectors: connectors.rows, freePolicy: freePolicy.rows[0] };
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
            routing_weight=$9,funding_mode=$10,commercial_use_approved=$11,
            commercial_approval_source=NULLIF($12,''),commercial_approval_reviewed_at=CASE WHEN $11 THEN now() ELSE NULL END,
            provider_rate_limit_rpm=$13,provider_concurrency_limit=$14,sponsored_enabled=$15,
            updated_at=now() WHERE id=$1`,
          [body.id, body.provider, body.providerModelId, body.inputPrice, body.outputPrice,
            body.capabilities, body.eligiblePlans, body.enabled, body.routingWeight,
            body.fundingMode ?? "managed_paid",Boolean(body.commercialUseApproved),body.commercialApprovalSource,
            body.providerRateLimitRpm || null,body.providerConcurrencyLimit || null,Boolean(body.sponsoredEnabled)],
        );
      } else if (body.action === "plan") {
        await client.query(
          `UPDATE pricing_plans SET included_allowance_usd=$2,features=$3::jsonb,active=$4,updated_at=now()
           WHERE code=$1`,
          [body.code, body.includedAllowanceUsd, JSON.stringify(body.features ?? []), body.active],
        );
      } else if (body.action === "freePolicy") {
        await client.query(
          `UPDATE platform_free_ai_policy SET enabled=$1,sponsored_model_id=$2,
            monthly_allowance_usd=$3,org_daily_request_limit=$4,user_daily_request_limit=$5,
            ip_daily_request_limit=$6,concurrency_limit=$7,updated_by=$8,updated_at=now()
           WHERE id='default'`,
          [Boolean(body.enabled),body.sponsoredModelId || null,Number(body.monthlyAllowanceUsd ?? 0),
            Number(body.orgDailyRequestLimit ?? 0),Number(body.userDailyRequestLimit ?? 0),
            Number(body.ipDailyRequestLimit ?? 0),Number(body.concurrencyLimit ?? 1),user.rows[0]!.id],
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
          `INSERT INTO platform_connectors(kind,label,app_id,bridge_url,credential_ciphertext,
            credential_nonce,credential_auth_tag,encrypted_dek,kms_key_id,model_mappings,
            metering_mode,enabled,feature_flag_enabled,approval_reference,approval_date,approval_acknowledged,daily_quota,created_by)
           VALUES('base44',$1,NULLIF($2,''),NULLIF($3,''),$4,$5,$6,$7,$8,$9::jsonb,'external_opaque',false,false,NULLIF($10,''),$11,$12,$13,$14)`,
          [body.label,body.appId,body.bridgeUrl,encrypted?.ciphertext ?? null,
            encrypted?.nonce ?? null,encrypted?.authTag ?? null,encrypted?.encryptedDek ?? null,
            encrypted?.kmsKeyId ?? null,JSON.stringify(body.modelMappings ?? {}),
            body.approvalReference,body.approvalDate??null,Boolean(body.approvalAcknowledged),Number(body.dailyQuota??0),user.rows[0]!.id],
        );
      } else if(body.action==="testBase44"){
        const row=(await client.query<{app_id:string;bridge_url:string;credential_ciphertext:string;credential_nonce:string;credential_auth_tag:string;encrypted_dek:string;kms_key_id:string;model_mappings:Record<string,string>}>(`SELECT app_id,bridge_url,credential_ciphertext,credential_nonce,credential_auth_tag,encrypted_dek,kms_key_id,model_mappings FROM platform_connectors WHERE id=$1 AND kind='base44'`,[body.id])).rows[0];if(!row)throw new Error("Base44 bridge configuration not found");const secret=await decryptSecret({ciphertext:row.credential_ciphertext,nonce:row.credential_nonce,authTag:row.credential_auth_tag,encryptedDek:row.encrypted_dek,kmsKeyId:row.kms_key_id},createKms()),mapping=Object.values(row.model_mappings)[0];if(!mapping)throw new Error("At least one documented model mapping is required");const transport=new HttpBase44BridgeTransport();const payload={requestId:crypto.randomUUID(),orgId:"platform-health-test",userId:user.rows[0]!.id,feature:"chat" as const,modelDisplay:mapping,messages:[{role:"user" as const,content:"Return the word healthy."}],maxTokens:8,nonce:crypto.randomUUID(),issuedAt:new Date().toISOString()};const response=await transport.invoke({bridgeUrl:row.bridge_url,appId:row.app_id,signingSecret:secret,timeoutMs:10_000},payload);if((response.status??500)>=400)throw new Error(`Base44 bridge health test returned ${response.status}`);await client.query(`UPDATE platform_connectors SET health_verified_at=now(),updated_at=now() WHERE id=$1`,[body.id]);
      } else if(body.action==="enableBase44"){
        const updated=await client.query(`UPDATE platform_connectors SET enabled=true,feature_flag_enabled=true,updated_at=now() WHERE id=$1 AND kind='base44' AND approval_acknowledged=true AND approval_reference IS NOT NULL AND approval_date IS NOT NULL AND health_verified_at IS NOT NULL RETURNING id`,[body.id]);if(!updated.rowCount)throw new Error("Base44 requires written approval acknowledgement and a passing health test before enablement");
      } else throw new Error("Unknown configuration action");
    },true);
    return Response.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
