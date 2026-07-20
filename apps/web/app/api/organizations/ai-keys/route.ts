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

      return {
        tier: membership.rows[0]?.tier ?? "free",
        role: membership.rows[0]?.role ?? null,
        canManage,
        keys: buildByokKeyStatuses(rows),
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
      // Never echo secrets — status only.
    });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      orgId?: string;
      provider?: string;
      apiKey?: string;
    };
    const { session, orgId } = await context(body.orgId);
    const provider = parseByokProvider(body.provider);
    if (!provider) throw new Error("Provider must be openai, anthropic, or google");

    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    if (!apiKey) throw new Error("API key is required");
    // Never log apiKey — reject empty after trim only.

    const encryption = aiKeysEncryptionStatus();
    if (!encryption.ok) {
      return Response.json(
        {
          error: encryption.message,
          setupRequired: true,
        },
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
      // Replace any prior first-party rows for this provider (legacy duplicates included).
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
