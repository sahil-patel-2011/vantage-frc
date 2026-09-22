import type { PoolClient } from "@neondatabase/serverless";
import { decryptRow } from "./resolve-chat-adapter";
import { TinyFishRun, type TinyFishFailure } from "./tinyfish";
import type { TeamWebOptions } from "./web-tools";

/**
 * Reading and reporting on a team's TinyFish key from inside an agent run.
 *
 * Both run on the request's `withRls` client, as the member who asked. Members
 * may read their team's encrypted row (migration 0667) so the key can be
 * decrypted here, server-side; it never leaves this process in plaintext and
 * is never returned to the browser.
 */

let savepointSeq = 0;

/**
 * Run one statement so that its failure cannot poison the rest of the tool.
 *
 * Every tool shares the request's single transaction. `runInToolSavepoint`
 * repairs it *between* tools, but inside one tool a swallowed SQL error leaves
 * the transaction aborted and the next query in the same tool fails too — so
 * a missing table on an unmigrated database would take the search down with
 * it. A savepoint around each statement keeps a failure where it happened.
 */
async function isolated<T>(client: PoolClient, work: () => Promise<T>): Promise<T | null> {
  savepointSeq += 1;
  const name = `tinyfish_sp_${savepointSeq % 1_000_000}`;
  try {
    await client.query(`SAVEPOINT ${name}`);
  } catch {
    // Not in a transaction (a test stub, an autocommit client): nothing to protect.
    try {
      return await work();
    } catch {
      return null;
    }
  }
  try {
    const result = await work();
    await client.query(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch {
    try {
      await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
      await client.query(`RELEASE SAVEPOINT ${name}`);
    } catch {
      // Connection unusable; withRls rolls the whole request back.
    }
    return null;
  }
}

type KeyRow = {
  keyCiphertext: string;
  keyNonce: string;
  keyAuthTag: string;
  encryptedDek: string;
  kmsKeyId: string;
};

/**
 * This team's TinyFish key, decrypted — or null when there is none, the table
 * does not exist yet, or it cannot be decrypted.
 *
 * Null is the honest answer to all three: the agent then says web search is
 * not set up for this team, rather than failing the whole answer. A key that
 * will not decrypt is a KMS problem the settings page reports on its own.
 */
export async function loadTinyfishKey(client: PoolClient, orgId: string): Promise<string | null> {
  const row = await isolated(client, async () => {
    const result = await client.query<KeyRow>(
      `SELECT key_ciphertext AS "keyCiphertext", key_nonce AS "keyNonce",
              key_auth_tag AS "keyAuthTag", encrypted_dek AS "encryptedDek",
              kms_key_id AS "kmsKeyId"
         FROM org_tool_keys
        WHERE org_id = $1::uuid AND tool = 'tinyfish'
        LIMIT 1`,
      [orgId],
    );
    return result.rows[0] ?? null;
  });
  if (!row) return null;
  try {
    const key = (await decryptRow(row, undefined)).trim();
    return key || null;
  } catch {
    return null;
  }
}

/**
 * Record how a call went, so a key TinyFish stops accepting shows up on the
 * settings page instead of the agent silently answering without the web.
 *
 * Goes through a SECURITY DEFINER function because a student's run is what made
 * the call, and students may not write the key row. The function touches the
 * health columns only. Best-effort: bookkeeping never fails an answer.
 */
export async function recordTinyfishOutcome(
  client: PoolClient,
  orgId: string,
  failure: TinyFishFailure | null,
): Promise<void> {
  await isolated(client, async () => {
    await client.query(`SELECT record_org_tool_key_outcome($1::uuid, 'tinyfish', $2::text)`, [
      orgId,
      failure,
    ]);
  });
}

/**
 * One agent run's access to the web: the team's key, loaded once on first use,
 * and one `TinyFishRun` holding which pages this run may read.
 *
 * Lazy because most turns never touch the web, and decrypting a key costs a KMS
 * round trip. One per tool registry, and registries are built per request, so
 * the allowlist of readable pages never outlives the answer it belongs to.
 */
export function createTeamWebSession(requestText?: string | null) {
  const runs = new Map<string, Promise<TinyFishRun | null>>();

  const runFor = (client: PoolClient, orgId: string): Promise<TinyFishRun | null> => {
    let pending = runs.get(orgId);
    if (!pending) {
      pending = loadTinyfishKey(client, orgId).then((apiKey) => {
        if (!apiKey) return null;
        const run = new TinyFishRun(apiKey);
        // Pages the person linked in their own question are readable at once.
        run.seedFromText(requestText);
        return run;
      });
      runs.set(orgId, pending);
    }
    return pending;
  };

  return {
    /** The options `executeWebSearch` / `executeWebFetch` take for this team. */
    async optionsFor(client: PoolClient, orgId: string): Promise<TeamWebOptions> {
      const tinyfish = await runFor(client, orgId);
      if (!tinyfish) return {};
      return {
        tinyfish,
        onTinyfishOutcome: (failure) => recordTinyfishOutcome(client, orgId, failure),
      };
    },
  };
}
