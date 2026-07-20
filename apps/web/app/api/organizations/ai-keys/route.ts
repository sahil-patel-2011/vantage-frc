import {
  describeOpenAiCompatibleReachability,
  LOCAL_OPENAI_COMPAT_KIND,
  LOCAL_OPENAI_COMPAT_LABEL,
  BYOK_MODEL_OPTIONS,
  validateOpenAiCompatibleBaseUrl,
} from "@vantage/agent";
import { createKms, encryptSecret } from "@vantage/billing";
import { assertOrgCapability, auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { aiKeysEncryptionStatus } from "../../../../lib/ai-keys/kms-status";
import {
  BYOK_PROVIDER_META,
  BYOK_PROVIDERS,
  buildByokKeyStatuses,
  parseByokProvider,
  type ByokProvider,
} from "../../../../lib/ai-keys/byok-providers";

async function context(orgId: string | undefined) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !orgId) throw new Error("Authentication and organization are required");
  return { session, orgId };
}

const fail = (error: unknown, status = 400) =>
  Response.json(
    { error: error instanceof Error ? error.message : "AI keys request failed" },
    { status },
  );

async function loadLocalConnector(client: Parameters<Parameters<typeof withRls>[1]>[0], orgId: string) {
  const row = (
    await client.query<{
      id: string;
      baseUrl: string | null;
      model: string | null;
      hasKey: boolean;
      lastTestedAt: string | null;
      enabled: boolean;
    }>(
      `SELECT id,
              base_url AS "baseUrl",
              COALESCE(model_mappings->>'default', model_mappings->>'chat') AS model,
              (key_ciphertext IS NOT NULL) AS "hasKey",
              last_tested_at::text AS "lastTestedAt",
              enabled
         FROM org_provider_configs
        WHERE org_id = $1::uuid
          AND label = $2
        ORDER BY created_at DESC
        LIMIT 1`,
      [orgId, LOCAL_OPENAI_COMPAT_LABEL],
    )
  ).rows[0];
  if (!row?.baseUrl) {
    return {
      configured: false as const,
      baseUrl: null,
      model: null,
      hasKey: false,
      lastTestedAt: null,
      reachabilityWarning: null as string | null,
    };
  }
  const reach = describeOpenAiCompatibleReachability(row.baseUrl);
  return {
    configured: true as const,
    id: row.id,
    baseUrl: row.baseUrl,
    model: row.model,
    hasKey: row.hasKey,
    lastTestedAt: row.lastTestedAt,
    enabled: row.enabled,
    reachabilityWarning: reach.warning,
  };
}

async function loadRoutingPrefs(client: Parameters<Parameters<typeof withRls>[1]>[0], orgId: string) {
  try {
    const row = (
      await client.query<{
        mode: string;
        fixedModelId: string | null;
        enabledModelIds: string[] | null;
      }>(
        `SELECT mode,
                fixed_model_id AS "fixedModelId",
                enabled_model_ids AS "enabledModelIds"
           FROM org_byok_routing_prefs
          WHERE org_id = $1::uuid`,
        [orgId],
      )
    ).rows[0];
    if (!row) {
      return {
        mode: "automode" as const,
        fixedModelId: null as string | null,
        enabledModelIds: BYOK_MODEL_OPTIONS.map((m) => m.id),
      };
    }
    return {
      mode: row.mode === "fixed" ? ("fixed" as const) : ("automode" as const),
      fixedModelId: row.fixedModelId,
      enabledModelIds:
        row.enabledModelIds && row.enabledModelIds.length
          ? row.enabledModelIds
          : BYOK_MODEL_OPTIONS.map((m) => m.id),
    };
  } catch {
    return {
      mode: "automode" as const,
      fixedModelId: null as string | null,
      enabledModelIds: BYOK_MODEL_OPTIONS.map((m) => m.id),
    };
  }
}

export async function GET(request: Request) {
  try {
    const orgId = new URL(request.url).searchParams.get("orgId") ?? undefined;
    const { session } = await context(orgId);
    const encryption = aiKeysEncryptionStatus();

    const payload = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const membership = await client.query<{ role: string; tier: string | null }>(
        `SELECT m.role, b.tier
         FROM memberships m
         LEFT JOIN org_billing b ON b.org_id = m.org_id
         WHERE m.org_id = $1::uuid AND m.user_id = $2::uuid`,
        [orgId, session.user.id],
      );
      if (!membership.rowCount) throw new Error("Organization access denied");

      let canManage = false;
      try {
        await assertOrgCapability(client, orgId!, "manage_api_keys");
        canManage = true;
      } catch {
        canManage = false;
      }

      const rows = (
        await client.query<{
          provider: string;
          createdAt: string | null;
          lastUsedAt: string | null;
        }>(
          `SELECT provider,
                  created_at::text AS "createdAt",
                  last_used_at::text AS "lastUsedAt"
           FROM org_llm_keys
           WHERE org_id = $1::uuid
             AND lower(provider) = ANY($2::text[])
           ORDER BY created_at DESC`,
          [orgId, [...BYOK_PROVIDERS]],
        )
      ).rows;

      const [localConnector, routing] = await Promise.all([
        loadLocalConnector(client, orgId!),
        loadRoutingPrefs(client, orgId!),
      ]);

      return {
        tier: membership.rows[0]?.tier ?? "free",
        role: membership.rows[0]?.role ?? null,
        canManage,
        keys: buildByokKeyStatuses(rows),
        localConnector,
        routing,
        modelOptions: BYOK_MODEL_OPTIONS.map((m) => ({
          id: m.id,
          provider: m.provider,
          modelId: m.modelId,
          label: m.label,
          tier: m.tier,
          tierLabel: m.tierLabel,
        })),
      };
    });

    return Response.json({
      ...payload,
      providers: BYOK_PROVIDERS.map((id) => ({
        id,
        label: BYOK_PROVIDER_META[id].label,
        placeholder: BYOK_PROVIDER_META[id].placeholder,
        docsHint: BYOK_PROVIDER_META[id].docsHint,
      })),
      setupRequired: !encryption.ok,
      setupMessage: encryption.ok ? null : encryption.message,
    });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      orgId?: string;
      action?:
        | "save_key"
        | "save_local"
        | "test_local"
        | "remove_local"
        | "save_routing";
      provider?: string;
      apiKey?: string;
      baseUrl?: string;
      model?: string;
      mode?: "fixed" | "automode";
      fixedModelId?: string | null;
      enabledModelIds?: string[];
    };
    const { session, orgId } = await context(body.orgId);
    const action = body.action ?? "save_key";

    if (action === "save_key") {
      const provider = parseByokProvider(body.provider);
      if (!provider) throw new Error("Provider must be openai, anthropic, or google");

      const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
      if (!apiKey) throw new Error("API key is required");

      const encryption = aiKeysEncryptionStatus();
      if (!encryption.ok) {
        return Response.json(
          { error: encryption.message, setupRequired: true },
          { status: 503 },
        );
      }

      let encrypted;
      try {
        encrypted = await encryptSecret(apiKey, createKms());
      } catch (error) {
        return Response.json(
          {
            error:
              error instanceof Error
                ? error.message
                : "Could not encrypt API key. Encryption setup is required.",
            setupRequired: true,
          },
          { status: 503 },
        );
      }

      const meta = BYOK_PROVIDER_META[provider];
      await withRls({ userId: session.user.id, orgId }, async (client) => {
        await assertOrgCapability(client, orgId, "manage_api_keys");
        await client.query(
          `DELETE FROM org_llm_keys
           WHERE org_id = $1::uuid AND lower(provider) = $2`,
          [orgId, provider],
        );
        await client.query(
          `INSERT INTO org_llm_keys
             (org_id, provider, label, key_ciphertext, key_nonce, key_auth_tag, encrypted_dek, kms_key_id, created_by)
           VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::uuid)`,
          [
            orgId,
            provider,
            meta.storageLabel,
            encrypted.ciphertext,
            encrypted.nonce,
            encrypted.authTag,
            encrypted.encryptedDek,
            encrypted.kmsKeyId,
            session.user.id,
          ],
        );
      });

      return Response.json({ ok: true, provider, configured: true }, { status: 201 });
    }

    if (action === "save_local") {
      const encryption = aiKeysEncryptionStatus();
      if (!encryption.ok) {
        return Response.json(
          { error: encryption.message, setupRequired: true },
          { status: 503 },
        );
      }
      const baseUrl = await validateOpenAiCompatibleBaseUrl(body.baseUrl ?? "");
      const model =
        typeof body.model === "string" && body.model.trim()
          ? body.model.trim()
          : "llama3.2";
      const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
      const encrypted = apiKey ? await encryptSecret(apiKey, createKms()) : null;
      const reach = describeOpenAiCompatibleReachability(baseUrl);

      await withRls({ userId: session.user.id, orgId }, async (client) => {
        await assertOrgCapability(client, orgId, "manage_api_keys");
        await client.query(
          `DELETE FROM org_provider_configs WHERE org_id = $1::uuid AND label = $2`,
          [orgId, LOCAL_OPENAI_COMPAT_LABEL],
        );
        await client.query(
          `INSERT INTO org_provider_configs
             (org_id, kind, label, base_url, local_relay, key_ciphertext, key_nonce, key_auth_tag,
              encrypted_dek, kms_key_id, model_mappings, enabled, created_by)
           VALUES ($1::uuid, $2, $3, $4, false, $5, $6, $7, $8, $9, $10::jsonb, true, $11::uuid)`,
          [
            orgId,
            LOCAL_OPENAI_COMPAT_KIND,
            LOCAL_OPENAI_COMPAT_LABEL,
            baseUrl,
            encrypted?.ciphertext ?? null,
            encrypted?.nonce ?? null,
            encrypted?.authTag ?? null,
            encrypted?.encryptedDek ?? null,
            encrypted?.kmsKeyId ?? null,
            JSON.stringify({ default: model, chat: model }),
            session.user.id,
          ],
        );
      });

      return Response.json(
        {
          ok: true,
          configured: true,
          baseUrl,
          model,
          reachabilityWarning: reach.warning,
        },
        { status: 201 },
      );
    }

    if (action === "test_local") {
      const result = await withRls({ userId: session.user.id, orgId }, async (client) => {
        await assertOrgCapability(client, orgId, "manage_api_keys");
        const row = (
          await client.query<{
            id: string;
            baseUrl: string | null;
            keyCiphertext: string | null;
            keyNonce: string | null;
            keyAuthTag: string | null;
            encryptedDek: string | null;
            kmsKeyId: string | null;
          }>(
            `SELECT id, base_url AS "baseUrl",
                    key_ciphertext AS "keyCiphertext", key_nonce AS "keyNonce",
                    key_auth_tag AS "keyAuthTag", encrypted_dek AS "encryptedDek",
                    kms_key_id AS "kmsKeyId"
               FROM org_provider_configs
              WHERE org_id = $1::uuid AND label = $2
              ORDER BY created_at DESC LIMIT 1`,
            [orgId, LOCAL_OPENAI_COMPAT_LABEL],
          )
        ).rows[0];
        if (!row?.baseUrl) throw new Error("Save a base URL before testing the connection");
        const endpoint = await validateOpenAiCompatibleBaseUrl(row.baseUrl);
        let apiKey = "";
        if (row.keyCiphertext && row.keyNonce && row.keyAuthTag && row.encryptedDek && row.kmsKeyId) {
          const { decryptSecret } = await import("@vantage/billing");
          apiKey = await decryptSecret(
            {
              ciphertext: row.keyCiphertext,
              nonce: row.keyNonce,
              authTag: row.keyAuthTag,
              encryptedDek: row.encryptedDek,
              kmsKeyId: row.kmsKeyId,
            },
            createKms(),
          );
        }
        const headersInit: Record<string, string> = {};
        if (apiKey) headersInit.authorization = `Bearer ${apiKey}`;
        const response = await fetch(`${endpoint}/models`, {
          headers: headersInit,
          signal: AbortSignal.timeout(5_000),
        });
        if (!response.ok) {
          throw new Error(
            response.status === 401 || response.status === 403
              ? `Connection rejected (${response.status}) — check the optional API key`
              : `Connection test returned ${response.status}. Is the server reachable from Vantage?`,
          );
        }
        await client.query(
          `UPDATE org_provider_configs SET last_tested_at = now(), updated_at = now() WHERE id = $1`,
          [row.id],
        );
        return {
          ok: true,
          reachabilityWarning: describeOpenAiCompatibleReachability(endpoint).warning,
        };
      });
      return Response.json(result);
    }

    if (action === "remove_local") {
      await withRls({ userId: session.user.id, orgId }, async (client) => {
        await assertOrgCapability(client, orgId, "manage_api_keys");
        await client.query(
          `DELETE FROM org_provider_configs WHERE org_id = $1::uuid AND label = $2`,
          [orgId, LOCAL_OPENAI_COMPAT_LABEL],
        );
      });
      return Response.json({ ok: true, configured: false });
    }

    if (action === "save_routing") {
      const mode = body.mode === "fixed" ? "fixed" : "automode";
      const fixedModelId =
        typeof body.fixedModelId === "string" && body.fixedModelId.trim()
          ? body.fixedModelId.trim()
          : null;
      if (mode === "fixed" && !fixedModelId) {
        throw new Error("Pick a fixed model when Fixed mode is selected");
      }
      if (fixedModelId && !BYOK_MODEL_OPTIONS.some((m) => m.id === fixedModelId)) {
        throw new Error("Fixed model is not in the supported BYOK catalog");
      }
      const enabledModelIds = Array.isArray(body.enabledModelIds)
        ? body.enabledModelIds.filter((id) => BYOK_MODEL_OPTIONS.some((m) => m.id === id))
        : BYOK_MODEL_OPTIONS.map((m) => m.id);
      if (mode === "automode" && enabledModelIds.length === 0) {
        throw new Error("Enable at least one model for Automode");
      }

      await withRls({ userId: session.user.id, orgId }, async (client) => {
        await assertOrgCapability(client, orgId, "manage_api_keys");
        await client.query(
          `INSERT INTO org_byok_routing_prefs
             (org_id, mode, fixed_model_id, enabled_model_ids, updated_by, updated_at)
           VALUES ($1::uuid, $2, $3, $4::text[], $5::uuid, now())
           ON CONFLICT (org_id) DO UPDATE SET
             mode = excluded.mode,
             fixed_model_id = excluded.fixed_model_id,
             enabled_model_ids = excluded.enabled_model_ids,
             updated_by = excluded.updated_by,
             updated_at = now()`,
          [orgId, mode, fixedModelId, enabledModelIds, session.user.id],
        );
      });

      return Response.json({ ok: true, mode, fixedModelId, enabledModelIds });
    }

    throw new Error("Unknown AI keys action");
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json()) as { orgId?: string; provider?: string };
    const { session, orgId } = await context(body.orgId);
    const provider = parseByokProvider(body.provider);
    if (!provider) throw new Error("Provider must be openai, anthropic, or google");

    await withRls({ userId: session.user.id, orgId }, async (client) => {
      await assertOrgCapability(client, orgId, "manage_api_keys");
      await client.query(
        `DELETE FROM org_llm_keys
         WHERE org_id = $1::uuid AND lower(provider) = $2`,
        [orgId, provider as ByokProvider],
      );
    });

    return Response.json({ ok: true, provider, configured: false });
  } catch (error) {
    return fail(error);
  }
}
