import {
  describeOpenAiCompatibleReachability,
  LOCAL_OPENAI_COMPAT_KIND,
  LOCAL_OPENAI_COMPAT_LABEL,
  BYOK_MODEL_OPTIONS,
  canonicalByokModelId,
  AI_HORDE_MODELS,
  isAiHordeEnabled,
  isAiHordeModel,
  teamDefaultRouting,
  validateOpenAiCompatibleBaseUrl,
} from "@vantage/agent";
import { createKms, encryptSecret } from "@vantage/billing";
import { assertOrgCapability, auth } from "@vantage/core";
import { withRls, withSavepoint } from "@vantage/db";
import { headers } from "next/headers";
import { checkProviderKey, skipsLiveKeyCheck, type ProviderKeyCheck } from "../../../../lib/ai-keys/check-provider-key";
import { aiKeysEncryptionStatus } from "../../../../lib/ai-keys/kms-status";
import {
  BYOK_PROVIDER_META,
  BYOK_PROVIDERS,
  buildByokKeyStatuses,
  parseByokProvider,
  type ByokProvider,
} from "../../../../lib/ai-keys/byok-providers";
import { publicErrorMessage } from "../../../../lib/security/public-error";

async function context(orgId: string | undefined) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !orgId) throw new Error("Authentication and organization are required");
  return { session, orgId };
}

/**
 * Several keys per provider (migration 0727): each team or personal key has a label, an order
 * and an on/off switch, and Ask AI fails over from one to the next. Before 0727 a save still
 * replaces the provider's key, as it always did.
 */
type KeyClient = Parameters<Parameters<typeof withRls>[1]>[0];

async function multiKeyReady(client: KeyClient): Promise<boolean> {
  const result = await client.query<{ ready: boolean }>(
    `SELECT to_regprocedure('public.note_llm_key_result(text,uuid,boolean,text)') IS NOT NULL AS ready`,
  );
  return result.rows[0]?.ready === true;
}

export type KeyRow = {
  id: string;
  provider: string;
  label: string;
  priority: number;
  enabled: boolean;
  createdAt: string | null;
  lastUsedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  baseUrl?: string | null;
  model?: string | null;
};

/** Never key material: the id, label, order, switch and what happened last. */
const KEY_ROW_COLUMNS = `k.id::text AS id, lower(k.provider) AS provider, k.label,
  COALESCE((to_jsonb(k) ->> 'priority')::int, 100) AS priority,
  COALESCE((to_jsonb(k) ->> 'enabled')::boolean, true) AS enabled,
  k.created_at::text AS "createdAt", k.last_used_at::text AS "lastUsedAt",
  to_jsonb(k) ->> 'last_error' AS "lastError", to_jsonb(k) ->> 'last_error_at' AS "lastErrorAt"`;

/** A label for a new key: what the person typed, or "<Provider> key <n>". */
function newKeyLabel(provider: ByokProvider, typed: unknown, existing: number): string {
  const label = typeof typed === "string" ? typed.trim().replace(/\s+/g, " ").slice(0, 60) : "";
  if (label) return label;
  const base = BYOK_PROVIDER_META[provider].label;
  return existing === 0 ? base : `${base} key ${existing + 1}`;
}

async function nextPriority(client: KeyClient, table: "org_llm_keys" | "member_llm_keys", orgId: string, provider: string, userId?: string) {
  const result = await client.query<{ next: number; count: number }>(
    table === "org_llm_keys"
      ? `SELECT COALESCE(max(priority), 0) + 1 AS next, count(*)::int AS count
           FROM org_llm_keys WHERE org_id = $1::uuid AND lower(provider) = $2`
      : `SELECT COALESCE(max(priority), 0) + 1 AS next, count(*)::int AS count
           FROM member_llm_keys WHERE org_id = $1::uuid AND lower(provider) = $2 AND user_id = $3::uuid`,
    table === "org_llm_keys" ? [orgId, provider] : [orgId, provider, userId],
  );
  return result.rows[0] ?? { next: 1, count: 0 };
}

/** Swap a key with its neighbour in its provider's order (renumbering 1..n first). */
async function moveKey(
  client: KeyClient,
  table: "org_llm_keys" | "member_llm_keys",
  key: { id: string; provider: string; orgId: string; userId?: string },
  direction: "up" | "down",
) {
  const rows = (
    await client.query<{ id: string }>(
      table === "org_llm_keys"
        ? `SELECT id::text FROM org_llm_keys WHERE org_id = $1::uuid AND lower(provider) = $2 ORDER BY priority, created_at`
        : `SELECT id::text FROM member_llm_keys WHERE org_id = $1::uuid AND lower(provider) = $2 AND user_id = $3::uuid
            ORDER BY priority, created_at`,
      table === "org_llm_keys" ? [key.orgId, key.provider] : [key.orgId, key.provider, key.userId],
    )
  ).rows.map((row) => row.id);
  const index = rows.indexOf(key.id);
  const swap = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || swap < 0 || swap >= rows.length) return;
  [rows[index], rows[swap]] = [rows[swap]!, rows[index]!];
  for (const [position, id] of rows.entries()) {
    await client.query(`UPDATE ${table} SET priority = $2::int WHERE id = $1::uuid`, [id, position + 1]);
  }
}

const fail = (error: unknown, status = 400) =>
  Response.json(
    { error: publicErrorMessage(error, "AI keys request failed") },
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

/**
 * The team's saved routing choice. A team that never saved one is shown the model it starts on
 * (teamDefaultRouting: Claude Haiku 5.5 when it has an Anthropic key), the same answer the chat
 * resolver uses.
 */
async function loadRoutingPrefs(
  client: Parameters<Parameters<typeof withRls>[1]>[0],
  orgId: string,
  keyProviders: readonly string[],
) {
  // org_byok_routing_prefs may predate its migration, so automode is the right
  // default — but the plain catch aborted the transaction, so the key list this
  // route loads next came back empty and the page said "no keys configured".
  const defaults = {
    mode: "automode" as const,
    fixedModelId: null as string | null,
    enabledModelIds: BYOK_MODEL_OPTIONS.map((m) => m.id),
    freeSwarmModel: null as string | null,
  };
  return withSavepoint(client, async () => {
    const row = (
      await client.query<{
        mode: string;
        fixedModelId: string | null;
        enabledModelIds: string[] | null;
        freeSwarmModel: string | null;
      }>(
        `SELECT mode,
                fixed_model_id AS "fixedModelId",
                enabled_model_ids AS "enabledModelIds",
                free_swarm_model AS "freeSwarmModel"
           FROM org_byok_routing_prefs
          WHERE org_id = $1::uuid`,
        [orgId],
      )
    ).rows[0];
    if (!row) return { ...defaults, ...teamDefaultRouting(keyProviders) };
    return {
      mode: row.mode === "fixed" ? ("fixed" as const) : ("automode" as const),
      // Through canonicalByokModelId: a saved id for a model the provider has since retired
      // still ticks its replacement on the page.
      fixedModelId: row.fixedModelId ? canonicalByokModelId(row.fixedModelId) : null,
      enabledModelIds:
        row.enabledModelIds && row.enabledModelIds.length
          ? row.enabledModelIds.map(canonicalByokModelId)
          : BYOK_MODEL_OPTIONS.map((m) => m.id),
      // Read through the allowlist, not trusted from the column. A value that
      // is no longer one Vantage accepts reads as "any", which is the default
      // and the safe answer.
      freeSwarmModel: isAiHordeModel(row.freeSwarmModel) ? row.freeSwarmModel : null,
    };
  }, defaults);
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
        // Stays false: the viewer can read keys but not manage them.
      }

      const rows = (
        await client.query<KeyRow>(
          `SELECT ${KEY_ROW_COLUMNS}
           FROM org_llm_keys k
           WHERE k.org_id = $1::uuid
             AND lower(k.provider) = ANY($2::text[])
           ORDER BY lower(k.provider), COALESCE((to_jsonb(k) ->> 'priority')::int, 100), k.created_at`,
          [orgId, [...BYOK_PROVIDERS]],
        )
      ).rows;
      const multiKey = await multiKeyReady(client);

      const [localConnector, routing] = await Promise.all([
        loadLocalConnector(client, orgId!),
        loadRoutingPrefs(
          client,
          orgId!,
          rows.filter((row) => row.enabled).map((row) => row.provider),
        ),
      ]);

      // The caller's own personal keys (RLS restricts rows to user_id = caller).
      const memberRows = (
        await client.query<KeyRow>(
          `SELECT ${KEY_ROW_COLUMNS}, k.base_url AS "baseUrl", k.model
           FROM member_llm_keys k
           WHERE k.org_id = $1::uuid AND k.user_id = $2::uuid
           ORDER BY lower(k.provider), COALESCE((to_jsonb(k) ->> 'priority')::int, 100), k.created_at`,
          [orgId, session.user.id],
        )
      ).rows;

      return {
        tier: membership.rows[0]?.tier ?? "free",
        role: membership.rows[0]?.role ?? null,
        canManage,
        keys: buildByokKeyStatuses(rows.filter((row) => row.enabled)),
        /** Every team key, in order per provider: several per provider since 0727. */
        keyList: rows,
        multiKey,
        memberKeys: memberRows,
        localConnector,
        routing,
        /*
          The free swarm, and which of its models this team prefers.

          Sent even when the pool is off so the page can say the option
          exists and is not switched on, rather than leaving a team to
          discover a free tier by reading the deployment's environment.
        */
        freeSwarm: {
          enabled: isAiHordeEnabled(),
          models: AI_HORDE_MODELS.map((m) => ({ id: m.id, label: m.label, note: m.note })),
        },
        modelOptions: BYOK_MODEL_OPTIONS.map((m) => ({
          id: m.id,
          provider: m.provider,
          modelId: m.modelId,
          label: m.label,
          tier: m.tier,
          tierLabel: m.tierLabel,
          ...(m.fixedOnly ? { fixedOnly: true } : {}),
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
        | "save_routing"
        | "save_member_key"
        | "remove_member_key"
        | "update_key"
        | "remove_key";
      /** update_key / remove_key: which key, and whether it is the team's or the caller's own. */
      keyId?: string;
      scope?: "team" | "member";
      label?: string;
      enabled?: boolean;
      move?: "up" | "down";
      provider?: string;
      apiKey?: string;
      baseUrl?: string;
      model?: string;
      mode?: "fixed" | "automode";
      fixedModelId?: string | null;
      enabledModelIds?: string[];
      /** An AI Horde model id, or null/absent for any on the allowlist. */
      freeSwarmModel?: string | null;
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

      // Only the team's key managers may make Vantage call a provider with a pasted key.
      await withRls({ userId: session.user.id, orgId }, (client) =>
        assertOrgCapability(client, orgId, "manage_api_keys"),
      );
      const check: ProviderKeyCheck = skipsLiveKeyCheck(apiKey)
        ? { status: "valid" }
        : await checkProviderKey(provider, apiKey);
      if (check.status === "rejected") {
        return Response.json({ error: check.message, field: "apiKey" }, { status: 422 });
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
      const added = await withRls({ userId: session.user.id, orgId }, async (client) => {
        await assertOrgCapability(client, orgId, "manage_api_keys");
        const multiKey = await multiKeyReady(client);
        // Before 0727 a provider holds one key: a save replaces it, as it always did.
        if (!multiKey) {
          await client.query(
            `DELETE FROM org_llm_keys
             WHERE org_id = $1::uuid AND lower(provider) = $2`,
            [orgId, provider],
          );
        }
        const order = multiKey ? await nextPriority(client, "org_llm_keys", orgId, provider) : { next: 100, count: 0 };
        const label = multiKey ? newKeyLabel(provider, (body as { label?: unknown }).label, order.count) : meta.storageLabel;
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO org_llm_keys
             (org_id, provider, label, key_ciphertext, key_nonce, key_auth_tag, encrypted_dek, kms_key_id, created_by)
           VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::uuid)
           RETURNING id::text`,
          [
            orgId,
            provider,
            label,
            encrypted.ciphertext,
            encrypted.nonce,
            encrypted.authTag,
            encrypted.encryptedDek,
            encrypted.kmsKeyId,
            session.user.id,
          ],
        );
        if (multiKey) {
          await client.query(`UPDATE org_llm_keys SET priority = $2::int WHERE id = $1::uuid`, [
            inserted.rows[0]!.id,
            order.next,
          ]);
        }
        return { id: inserted.rows[0]!.id, label, position: order.count + 1 };
      });

      return Response.json(
        {
          ok: true,
          provider,
          configured: true,
          keyId: added.id,
          label: added.label,
          position: added.position,
          checked: check.status === "valid",
          notice: check.status === "unchecked" ? check.message : null,
        },
        { status: 201 },
      );
    }

    if (action === "save_member_key") {
      // A member's own key overrides the team key for that member only.
      // No capability check: RLS pins the row to the caller (0442).
      const provider = parseByokProvider(body.provider);
      if (!provider) throw new Error("Provider must be openai, anthropic, google, or openrouter");
      const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
      if (!apiKey) throw new Error("API key is required");

      const encryption = aiKeysEncryptionStatus();
      if (!encryption.ok) {
        return Response.json({ error: encryption.message, setupRequired: true }, { status: 503 });
      }

      // Base URL only means something on OpenAI-compatible entries (Ollama,
      // LM Studio, Groq, Mistral, anything speaking that protocol).
      const baseUrl =
        provider === "openai" && typeof body.baseUrl === "string" && body.baseUrl.trim()
          ? await validateOpenAiCompatibleBaseUrl(body.baseUrl)
          : null;
      const model =
        typeof body.model === "string" && body.model.trim() ? body.model.trim() : null;

      // A key for a custom base URL (Groq, a shop server) belongs to that server, not the
      // provider named on the card, so only keys for the provider itself are checked.
      const memberCheck: ProviderKeyCheck =
        baseUrl || skipsLiveKeyCheck(apiKey) ? { status: "valid" } : await checkProviderKey(provider, apiKey);
      if (memberCheck.status === "rejected") {
        return Response.json({ error: memberCheck.message, field: "apiKey" }, { status: 422 });
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
      const addedMine = await withRls({ userId: session.user.id, orgId }, async (client) => {
        const multiKey = await multiKeyReady(client);
        if (!multiKey) {
          await client.query(
            `DELETE FROM member_llm_keys
             WHERE org_id = $1::uuid AND user_id = $2::uuid AND lower(provider) = $3`,
            [orgId, session.user.id, provider],
          );
        }
        const order = multiKey
          ? await nextPriority(client, "member_llm_keys", orgId, provider, session.user.id)
          : { next: 100, count: 0 };
        const label = multiKey ? newKeyLabel(provider, (body as { label?: unknown }).label, order.count) : meta.storageLabel;
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO member_llm_keys
             (org_id, user_id, provider, label, key_ciphertext, key_nonce, key_auth_tag,
              encrypted_dek, kms_key_id, base_url, model)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING id::text`,
          [
            orgId,
            session.user.id,
            provider,
            label,
            encrypted.ciphertext,
            encrypted.nonce,
            encrypted.authTag,
            encrypted.encryptedDek,
            encrypted.kmsKeyId,
            baseUrl,
            model,
          ],
        );
        if (multiKey) {
          await client.query(`UPDATE member_llm_keys SET priority = $2::int WHERE id = $1::uuid`, [
            inserted.rows[0]!.id,
            order.next,
          ]);
        }
        return { id: inserted.rows[0]!.id, label, position: order.count + 1 };
      });

      return Response.json(
        {
          ok: true,
          provider,
          scope: "member",
          keyId: addedMine.id,
          label: addedMine.label,
          position: addedMine.position,
          notice: memberCheck.status === "unchecked" ? memberCheck.message : null,
        },
        { status: 201 },
      );
    }

    if (action === "remove_member_key") {
      const provider = parseByokProvider(body.provider);
      if (!provider) throw new Error("Provider must be openai, anthropic, google, or openrouter");
      await withRls({ userId: session.user.id, orgId }, async (client) => {
        await client.query(
          `DELETE FROM member_llm_keys
           WHERE org_id = $1::uuid AND user_id = $2::uuid AND lower(provider) = $3`,
          [orgId, session.user.id, provider],
        );
      });
      return Response.json({ ok: true, provider, scope: "member" });
    }

    if (action === "update_key" || action === "remove_key") {
      const keyId = typeof body.keyId === "string" ? body.keyId.trim() : "";
      if (!/^[0-9a-f-]{36}$/i.test(keyId)) throw new Error("Choose a key from the list");
      const scope = body.scope === "member" ? "member" : "team";
      const table = scope === "member" ? "member_llm_keys" : "org_llm_keys";
      const result = await withRls({ userId: session.user.id, orgId }, async (client) => {
        // Team keys are the key managers'; RLS (owner/admin) backs this. A personal key is only
        // ever the caller's own (member_llm_keys_own).
        if (scope === "team") await assertOrgCapability(client, orgId, "manage_api_keys");
        const key = (
          await client.query<{ id: string; provider: string; label: string }>(
            scope === "team"
              ? `SELECT id::text, lower(provider) AS provider, label FROM org_llm_keys WHERE id = $1::uuid AND org_id = $2::uuid`
              : `SELECT id::text, lower(provider) AS provider, label FROM member_llm_keys
                  WHERE id = $1::uuid AND org_id = $2::uuid AND user_id = $3::uuid`,
            scope === "team" ? [keyId, orgId] : [keyId, orgId, session.user.id],
          )
        ).rows[0];
        if (!key) throw new Error("That key is gone. Refresh the page.");
        if (action === "remove_key") {
          await client.query(`DELETE FROM ${table} WHERE id = $1::uuid`, [keyId]);
          return { removed: true, provider: key.provider, label: key.label };
        }
        if (!(await multiKeyReady(client))) {
          throw new Error("Ordering and switching keys needs the latest database update. Ask your platform admin to run it.");
        }
        if (typeof body.label === "string") {
          const label = body.label.trim().replace(/\s+/g, " ");
          if (!label || label.length > 60) throw new Error("Give the key a name of up to 60 characters");
          await client.query(`UPDATE ${table} SET label = $2 WHERE id = $1::uuid`, [keyId, label]);
        }
        if (typeof body.enabled === "boolean") {
          await client.query(`UPDATE ${table} SET enabled = $2::boolean WHERE id = $1::uuid`, [keyId, body.enabled]);
        }
        if (body.move === "up" || body.move === "down") {
          await moveKey(client, table, { id: keyId, provider: key.provider, orgId, userId: session.user.id }, body.move);
        }
        return { removed: false, provider: key.provider, label: key.label };
      });
      return Response.json({ ok: true, ...result, scope });
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
              ? "That server refused the connection. Check the address and the API key."
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

      /*
        Validated here rather than taken from the request.

        The swarm hosts models Vantage will not put in front of a student —
        roleplay builds, and several advertising that they have had their
        guardrails removed. The allowlist in `ai-horde-pool.ts` is what stops
        one being used, so a value arriving from a browser is checked against
        it and anything else becomes "any", which is the default. The adapter
        checks again when it builds the request; neither check is the only one.
      */
      const freeSwarmModel = isAiHordeModel(body.freeSwarmModel)
        ? body.freeSwarmModel
        : null;

      await withRls({ userId: session.user.id, orgId }, async (client) => {
        await assertOrgCapability(client, orgId, "manage_api_keys");
        await client.query(
          `INSERT INTO org_byok_routing_prefs
             (org_id, mode, fixed_model_id, enabled_model_ids, free_swarm_model, updated_by, updated_at)
           VALUES ($1::uuid, $2, $3, $4::text[], $5, $6::uuid, now())
           ON CONFLICT (org_id) DO UPDATE SET
             mode = excluded.mode,
             fixed_model_id = excluded.fixed_model_id,
             enabled_model_ids = excluded.enabled_model_ids,
             free_swarm_model = excluded.free_swarm_model,
             updated_by = excluded.updated_by,
             updated_at = now()`,
          [orgId, mode, fixedModelId, enabledModelIds, freeSwarmModel, session.user.id],
        );
      });

      return Response.json({ ok: true, mode, fixedModelId, enabledModelIds, freeSwarmModel });
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
