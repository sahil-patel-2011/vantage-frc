import {
  TINYFISH_KEY_PAGE_URL,
  looksLikeTinyfishKey,
  tinyfishKeyHint,
  verifyTinyfishKey,
} from "@vantage/agent";
import { createKms, encryptSecret } from "@vantage/billing";
import { assertOrgCapability, auth } from "@vantage/core";
import { withRls, withSavepointOrThrow } from "@vantage/db";
import { headers } from "next/headers";
import { aiKeysEncryptionStatus } from "../../../../lib/ai-keys/kms-status";
import { createRateLimiter, rateLimitedResponse } from "../../../../lib/rate-limit";
import { publicErrorMessage } from "../../../../lib/security/public-error";

/**
 * A team's keys for the tools its AI agent calls — today, TinyFish (web search
 * and page reading on the team's own free quota).
 *
 * Kept apart from /api/organizations/ai-keys on purpose: those are model keys,
 * stored in org_llm_keys, and the billing and routing code treat any row there
 * as "this team brought an AI model". See migration 0667.
 *
 * Nothing here ever returns a key, a fragment of one beyond the last four
 * characters, or ciphertext. `tests/browser/tinyfish-key-never-returned.spec.ts`
 * holds the whole route to that.
 */

/*
  Saving a key makes a live call to TinyFish to check it. Unlimited, that turns
  this route into a free oracle for testing stolen TinyFish keys — sign in once,
  post key after key, read which ones verify. The limit is per person, and the
  capability check below runs before any key is sent anywhere.
*/
const saveLimiter = createRateLimiter({ limit: 10, windowMs: 10 * 60_000, namespace: "org-tool-keys" });

type ToolKeyStatus = {
  configured: boolean;
  /** "ab12" — the last four characters, and never more. */
  hint: string | null;
  verifiedAt: string | null;
  lastUsedAt: string | null;
  lastError: "invalid_key" | "rate_limited" | "unavailable" | "bad_request" | null;
  lastErrorAt: string | null;
};

const EMPTY: ToolKeyStatus = {
  configured: false,
  hint: null,
  verifiedAt: null,
  lastUsedAt: null,
  lastError: null,
  lastErrorAt: null,
};

async function session() {
  const current = await auth.api.getSession({ headers: await headers() });
  if (!current) throw new HttpError(401, "Sign in to manage this team's keys.");
  return current;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function fail(error: unknown) {
  if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
  if (isMissingTable(error)) {
    return Response.json({ error: NOT_MIGRATED_MESSAGE, setupRequired: true }, { status: 503 });
  }
  const message = publicErrorMessage(error, "Request failed");
  // A capability refusal from assertOrgCapability.
  if (/capabilit|permission|not allowed|forbidden/i.test(message)) {
    return Response.json({ error: "Only a member who manages this team's API keys can change them." }, { status: 403 });
  }
  return Response.json({ error: message }, { status: 400 });
}

/**
 * The table arrives with migration 0667, and deploys here do not run
 * migrations — so for a while after a deploy the code can be live on a database
 * that has never heard of org_tool_keys. Postgres says so with 42P01.
 *
 * That window must read as "not set up yet", never as a raw
 * `relation "org_tool_keys" does not exist` shown to a team owner.
 */
const NOT_MIGRATED_MESSAGE =
  "Web research is not switched on for this server yet. It needs a database update before keys can be saved.";

function isMissingTable(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "42P01" || /relation "?org_tool_keys"? does not exist/i.test(String((error as Error)?.message ?? ""));
}

const isUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

async function readStatus(
  client: Parameters<Parameters<typeof withRls>[1]>[0],
  orgId: string,
): Promise<ToolKeyStatus> {
  try {
    const row = (
      await client.query<{
        hint: string;
        verifiedAt: string | null;
        lastUsedAt: string | null;
        lastError: ToolKeyStatus["lastError"];
        lastErrorAt: string | null;
      }>(
        // Status columns only — the ciphertext is deliberately not selected.
        `SELECT key_hint AS hint,
                verified_at::text AS "verifiedAt",
                last_used_at::text AS "lastUsedAt",
                last_error AS "lastError",
                last_error_at::text AS "lastErrorAt"
           FROM org_tool_keys
          WHERE org_id = $1::uuid AND tool = 'tinyfish'
          LIMIT 1`,
        [orgId],
      )
    ).rows[0];
    if (!row) return EMPTY;
    return { ...row, configured: true, hint: row.hint || null };
  } catch (error) {
    // Not migrated yet: let GET say so, rather than showing a form that cannot save.
    if (isMissingTable(error)) throw error;
    return EMPTY;
  }
}

async function canManage(client: Parameters<Parameters<typeof withRls>[1]>[0], orgId: string): Promise<boolean> {
  try {
    await assertOrgCapability(client, orgId, "manage_api_keys");
    return true;
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  try {
    const { user } = await session();
    const orgId = new URL(request.url).searchParams.get("orgId");
    if (!isUuid(orgId)) throw new HttpError(400, "A valid orgId is required.");
    const encryption = aiKeysEncryptionStatus();
    let migrated = true;
    const data = await withRls({ userId: user.id, orgId }, async (client) => {
      let tinyfish = EMPTY;
      try {
        // In a savepoint: on an unmigrated database this query fails, and without
        // one the whole transaction is aborted and canManage below fails with it.
        tinyfish = await withSavepointOrThrow(client, () => readStatus(client, orgId));
      } catch (error) {
        if (!isMissingTable(error)) throw error;
        migrated = false;
      }
      return { tinyfish, canManage: await canManage(client, orgId) };
    });
    const setupMessage = !migrated ? NOT_MIGRATED_MESSAGE : encryption.ok ? null : encryption.message;
    return Response.json(
      {
        ...data,
        keyPageUrl: TINYFISH_KEY_PAGE_URL,
        setupRequired: setupMessage !== null,
        setupMessage,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user } = await session();
    const body = (await request.json().catch(() => ({}))) as { orgId?: unknown; tool?: unknown; apiKey?: unknown };
    if (!isUuid(body.orgId)) throw new HttpError(400, "A valid orgId is required.");
    const orgId = body.orgId;
    if (body.tool !== undefined && body.tool !== "tinyfish") throw new HttpError(400, "Unknown tool.");

    // Permission first, before a key goes anywhere.
    const allowed = await withRls({ userId: user.id, orgId }, (client) => canManage(client, orgId));
    if (!allowed) throw new HttpError(403, "Only a member who manages this team's API keys can change them.");

    if (!(await saveLimiter.allow(user.id))) {
      return rateLimitedResponse("Too many key changes. Wait a few minutes and try again.");
    }

    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    if (!apiKey) throw new HttpError(400, "Paste your TinyFish API key.");
    if (!looksLikeTinyfishKey(apiKey)) {
      throw new HttpError(400, "That does not look like a TinyFish key. They start with sk-tinyfish-.");
    }

    const encryption = aiKeysEncryptionStatus();
    if (!encryption.ok) {
      return Response.json({ error: encryption.message, setupRequired: true }, { status: 503 });
    }

    // Check it works before storing it, so a typo is caught here and not in the
    // middle of somebody's answer.
    const verdict = await verifyTinyfishKey(apiKey);
    if (!verdict.ok) {
      const status = verdict.kind === "unavailable" ? 502 : 400;
      return Response.json(
        {
          error:
            verdict.kind === "invalid_key"
              ? "TinyFish did not accept that key. Check it on your TinyFish dashboard and paste it again."
              : verdict.message,
        },
        { status },
      );
    }

    let encrypted;
    try {
      encrypted = await encryptSecret(apiKey, createKms());
    } catch {
      return Response.json(
        { error: "Could not encrypt the key. Encryption setup is required.", setupRequired: true },
        { status: 503 },
      );
    }

    const status = await withRls({ userId: user.id, orgId }, async (client) => {
      await assertOrgCapability(client, orgId, "manage_api_keys");
      await client.query(
        `INSERT INTO org_tool_keys
           (org_id, tool, key_ciphertext, key_nonce, key_auth_tag, encrypted_dek, kms_key_id,
            key_hint, created_by, verified_at)
         VALUES ($1::uuid, 'tinyfish', $2, $3, $4, $5, $6, $7, $8::uuid, now())
         ON CONFLICT (org_id, tool) DO UPDATE SET
           key_ciphertext = EXCLUDED.key_ciphertext,
           key_nonce = EXCLUDED.key_nonce,
           key_auth_tag = EXCLUDED.key_auth_tag,
           encrypted_dek = EXCLUDED.encrypted_dek,
           kms_key_id = EXCLUDED.kms_key_id,
           key_hint = EXCLUDED.key_hint,
           created_by = EXCLUDED.created_by,
           verified_at = now(),
           last_error = NULL,
           last_error_at = NULL,
           updated_at = now()`,
        [
          orgId,
          encrypted.ciphertext,
          encrypted.nonce,
          encrypted.authTag,
          encrypted.encryptedDek,
          encrypted.kmsKeyId,
          tinyfishKeyHint(apiKey),
          user.id,
        ],
      );
      return readStatus(client, orgId);
    });

    return Response.json({ ok: true, tinyfish: status }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { user } = await session();
    const body = (await request.json().catch(() => ({}))) as { orgId?: unknown };
    if (!isUuid(body.orgId)) throw new HttpError(400, "A valid orgId is required.");
    const orgId = body.orgId;
    await withRls({ userId: user.id, orgId }, async (client) => {
      await assertOrgCapability(client, orgId, "manage_api_keys");
      await client.query(`DELETE FROM org_tool_keys WHERE org_id = $1::uuid AND tool = 'tinyfish'`, [orgId]);
    });
    return Response.json({ ok: true, tinyfish: EMPTY });
  } catch (error) {
    return fail(error);
  }
}
