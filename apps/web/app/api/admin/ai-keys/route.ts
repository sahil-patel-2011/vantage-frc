import type { PoolClient } from "@neondatabase/serverless";
import { createKms, encryptSecret } from "@vantage/billing";
import { assertPlatformPrivilegeMfa, writeAdminAction } from "@vantage/core";
import {
  AdminRouteError,
  NO_STORE,
  UUID_PATTERN,
  adminErrorResponse,
  asPlatformAdmin,
  readJsonBody,
} from "../../../../lib/admin/admin-route";
import { giftRefusal, loadKeyPool, parsePoolKeyAdd, providerForFamily } from "../../../../lib/admin/ai-credits";
import { aiKeysEncryptionStatus } from "../../../../lib/ai-keys/kms-status";

/**
 * The operator's key pool that pays for AI credit gifts (platform_provider_keys, 0727): any
 * number of keys per provider, each a pasted key (envelope-encrypted, never shown again) or the
 * name of a provider-key environment variable, with a label, an order and an on/off switch.
 * GET lists them with last use, spend and any degraded mark; no response carries a secret.
 * Changes need a recent sign-in and, when the operator has an authenticator, a step-up.
 */

async function actor(client: PoolClient): Promise<string> {
  return (await client.query<{ id: string }>("SELECT current_app_user_id() AS id")).rows[0]!.id;
}

/** Number the provider's keys 1..n in their current order, so a move is a swap of neighbours. */
async function renumber(client: PoolClient, provider: string): Promise<Array<{ id: string; priority: number }>> {
  const rows = (
    await client.query<{ id: string }>(
      `SELECT id::text FROM platform_provider_keys WHERE lower(provider) = $1::text ORDER BY priority, created_at`,
      [provider],
    )
  ).rows;
  for (const [index, row] of rows.entries()) {
    await client.query(`UPDATE platform_provider_keys SET priority = $2::int WHERE id = $1::uuid`, [row.id, index + 1]);
  }
  return rows.map((row, index) => ({ id: row.id, priority: index + 1 }));
}

export async function GET() {
  try {
    const pool = await asPlatformAdmin((client) => loadKeyPool(client));
    return Response.json(pool, { headers: NO_STORE });
  } catch (error) {
    return adminErrorResponse(error, "The keys didn't load. Try again.", giftRefusal);
  }
}

/** Add a key: `{ family, label, envName }` or `{ family, label, secret }`. */
export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const added = await asPlatformAdmin(
      async (client, session) => {
        await assertPlatformPrivilegeMfa(client, { userId: session.user.id, sessionId: session.session.id });
        const input = parsePoolKeyAdd(body);
        const provider = providerForFamily(input.family);
        const next = (
          await client.query<{ next: number }>(
            `SELECT COALESCE(max(priority), 0) + 1 AS next FROM platform_provider_keys WHERE lower(provider) = $1::text`,
            [provider],
          )
        ).rows[0]!.next;
        let id: string;
        if (input.kind === "env") {
          id = (
            await client.query<{ id: string }>(
              `INSERT INTO platform_provider_keys(provider, label, key_env, created_by, priority)
               VALUES ($1::text, $2::text, $3::text, current_app_user_id(), $4::int) RETURNING id::text`,
              [provider, input.label, input.envName, next],
            )
          ).rows[0]!.id;
        } else {
          const encryption = aiKeysEncryptionStatus();
          if (!encryption.ok) throw new AdminRouteError(503, encryption.message ?? "Key encryption is not set up.", "setup_required");
          const sealed = await encryptSecret(input.secret, createKms());
          id = (
            await client.query<{ id: string }>(
              `INSERT INTO platform_provider_keys(provider, label, key_ciphertext, key_nonce, key_auth_tag,
                 encrypted_dek, kms_key_id, created_by, priority)
               VALUES ($1::text, $2::text, $3, $4, $5, $6, $7, current_app_user_id(), $8::int) RETURNING id::text`,
              [provider, input.label, sealed.ciphertext, sealed.nonce, sealed.authTag, sealed.encryptedDek, sealed.kmsKeyId, next],
            )
          ).rows[0]!.id;
        }
        await writeAdminAction(client, {
          actorUserId: await actor(client),
          action: "ai_key.added",
          payload: { keyId: id, provider, label: input.label, source: input.kind, ...(input.kind === "env" ? { envName: input.envName } : {}) },
        });
        return { id, provider };
      },
      { fresh: true },
    );
    return Response.json(added, { status: 201, headers: NO_STORE });
  } catch (error) {
    return adminErrorResponse(error, "The key wasn't added. Try again in a minute.", giftRefusal);
  }
}

/** `{ id, label? , enabled?, move?: "up" | "down" }`. */
export async function PATCH(request: Request) {
  try {
    const body = await readJsonBody(request);
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!UUID_PATTERN.test(id)) throw new AdminRouteError(400, "Choose a key from the list.");
    await asPlatformAdmin(
      async (client) => {
        const row = (
          await client.query<{ provider: string; label: string }>(
            `SELECT lower(provider) AS provider, label FROM platform_provider_keys WHERE id = $1::uuid FOR UPDATE`,
            [id],
          )
        ).rows[0];
        if (!row) throw new AdminRouteError(404, "That key is gone. Refresh the page.", "not_found");
        const changes: Record<string, unknown> = {};
        if (typeof body.label === "string") {
          const label = body.label.trim().replace(/\s+/g, " ");
          if (!label || label.length > 80) throw new AdminRouteError(400, "Give the key a name of up to 80 characters.");
          await client.query(`UPDATE platform_provider_keys SET label = $2::text WHERE id = $1::uuid`, [id, label]);
          changes.label = label;
        }
        if (typeof body.enabled === "boolean") {
          await client.query(
            `UPDATE platform_provider_keys SET disabled_at = CASE WHEN $2::boolean THEN NULL ELSE COALESCE(disabled_at, now()) END
              WHERE id = $1::uuid`,
            [id, body.enabled],
          );
          changes.enabled = body.enabled;
        }
        if (body.move === "up" || body.move === "down") {
          const order = await renumber(client, row.provider);
          const index = order.findIndex((entry) => entry.id === id);
          const other = order[body.move === "up" ? index - 1 : index + 1];
          if (other) {
            await client.query(`UPDATE platform_provider_keys SET priority = $2::int WHERE id = $1::uuid`, [id, other.priority]);
            await client.query(`UPDATE platform_provider_keys SET priority = $2::int WHERE id = $1::uuid`, [other.id, order[index]!.priority]);
          }
          changes.move = body.move;
        }
        if (Object.keys(changes).length === 0) throw new AdminRouteError(400, "Nothing to change.");
        await writeAdminAction(client, {
          actorUserId: await actor(client),
          action: "ai_key.changed",
          payload: { keyId: id, provider: row.provider, label: row.label, ...changes },
        });
      },
      { fresh: true },
    );
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    return adminErrorResponse(error, "Nothing changed. Try again in a minute.", giftRefusal);
  }
}

/** `{ id }`: spend already recorded against the key stays on the ledger. */
export async function DELETE(request: Request) {
  try {
    const body = await readJsonBody(request);
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!UUID_PATTERN.test(id)) throw new AdminRouteError(400, "Choose a key from the list.");
    await asPlatformAdmin(
      async (client, session) => {
        await assertPlatformPrivilegeMfa(client, { userId: session.user.id, sessionId: session.session.id });
        const removed = (
          await client.query<{ provider: string; label: string }>(
            `DELETE FROM platform_provider_keys WHERE id = $1::uuid RETURNING provider, label`,
            [id],
          )
        ).rows[0];
        if (!removed) throw new AdminRouteError(404, "That key is gone. Refresh the page.", "not_found");
        await writeAdminAction(client, {
          actorUserId: await actor(client),
          action: "ai_key.removed",
          payload: { keyId: id, provider: removed.provider, label: removed.label },
        });
      },
      { fresh: true },
    );
    return Response.json({ removed: id }, { headers: NO_STORE });
  } catch (error) {
    return adminErrorResponse(error, "The key is still there. Try again in a minute.", giftRefusal);
  }
}
