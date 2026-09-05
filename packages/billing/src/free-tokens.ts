import type { PoolClient } from "@neondatabase/serverless";

/**
 * Gifted free-token allowances. Separate from request credits: an admin chooses
 * a source and an amount, and a Freebuff gift is shown to the team only as
 * free tokens. Balance is always SUM(ledger).
 */

export const FREE_TOKEN_SOURCES = ["freebuff", "hosted_platform", "credits"] as const;
export type FreeTokenSource = (typeof FREE_TOKEN_SOURCES)[number];

export function isFreeTokenSource(value: unknown): value is FreeTokenSource {
  return typeof value === "string" && (FREE_TOKEN_SOURCES as readonly string[]).includes(value);
}

export type FreeTokenBalance = {
  source: FreeTokenSource;
  granted: number;
  spent: number;
  balance: number;
};

export class FreeTokensExhaustedError extends Error {
  readonly code = "free_tokens_exhausted";

  constructor(readonly needed: number, readonly available: number) {
    super(
      `This team is out of free tokens (needed ${needed}, ${available} left). ` +
        "Ask a platform admin to gift more, or add your own API key.",
    );
    this.name = "FreeTokensExhaustedError";
  }
}

export function estimatedFreeTokens(input: {
  estimatedPromptTokens?: number;
  estimatedCompletionTokens?: number;
}): number {
  const prompt = Math.max(0, Math.floor(input.estimatedPromptTokens ?? 800));
  const completion = Math.max(0, Math.floor(input.estimatedCompletionTokens ?? 400));
  return Math.max(1, prompt + completion);
}

export function isMissingFreeTokenSchema(error: unknown): boolean {
  return error instanceof Error && /ai_free_token_ledger|org_ai_free_tokens/.test(error.message);
}

export async function loadFreeTokenBalances(
  client: PoolClient,
  orgId: string,
): Promise<FreeTokenBalance[]> {
  try {
    const result = await client.query<{
      source: FreeTokenSource;
      granted: string;
      spent: string;
      balance: string;
    }>(
      `SELECT source, granted, spent, balance
         FROM org_ai_free_tokens
        WHERE org_id = $1::uuid
        ORDER BY source`,
      [orgId],
    );
    return result.rows.map((row) => ({
      source: row.source,
      granted: Number(row.granted),
      spent: Number(row.spent),
      balance: Number(row.balance),
    }));
  } catch (error) {
    if (isMissingFreeTokenSchema(error)) return [];
    throw error;
  }
}

export async function loadFreeTokenBalance(
  client: PoolClient,
  orgId: string,
  source: FreeTokenSource,
): Promise<FreeTokenBalance> {
  const rows = await loadFreeTokenBalances(client, orgId);
  return rows.find((row) => row.source === source) ?? { source, granted: 0, spent: 0, balance: 0 };
}

/** A grant row exists for this source — the team is on the token plan for it. */
export async function orgUsesFreeTokens(
  client: PoolClient,
  orgId: string,
  source: FreeTokenSource,
): Promise<boolean> {
  try {
    const result = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM ai_free_token_ledger
          WHERE org_id = $1::uuid
            AND source = $2
            AND entry_kind = 'grant'
            AND (expires_at IS NULL OR expires_at > now())
       ) AS exists`,
      [orgId, source],
    );
    return result.rows[0]?.exists === true;
  } catch (error) {
    if (isMissingFreeTokenSchema(error)) return false;
    throw error;
  }
}

export async function grantFreeTokens(
  client: PoolClient,
  input: {
    orgId: string;
    tokens: number;
    source: FreeTokenSource;
    actorUserId: string;
    reason?: string;
    expiresAt?: Date | null;
  },
): Promise<string> {
  const tokens = Math.floor(input.tokens);
  if (!Number.isFinite(tokens) || tokens <= 0) {
    throw new Error("tokens must be a positive whole number");
  }
  try {
    const result = await client.query<{ id: string }>(
      `INSERT INTO ai_free_token_ledger
         (org_id, source, entry_kind, tokens, expires_at, actor_user_id, reason)
       VALUES ($1::uuid, $2, 'grant', $3, $4, $5::uuid, $6)
       RETURNING id`,
      [
        input.orgId,
        input.source,
        tokens,
        input.expiresAt ?? null,
        input.actorUserId,
        input.reason ?? "",
      ],
    );
    return result.rows[0]!.id;
  } catch (error) {
    if (isMissingFreeTokenSchema(error)) {
      throw new Error("Apply migration 0523_ai_free_token_gifts.sql before gifting tokens.", {
        cause: error,
      });
    }
    throw error;
  }
}

export async function authorizeFreeTokens(
  client: PoolClient,
  input: {
    orgId: string;
    source: FreeTokenSource;
    tokens: number;
  },
): Promise<number> {
  if (!(await orgUsesFreeTokens(client, input.orgId, input.source))) return 0;
  const tokens = Math.max(1, Math.floor(input.tokens));
  const { balance } = await loadFreeTokenBalance(client, input.orgId, input.source);
  if (balance < tokens) throw new FreeTokensExhaustedError(tokens, Math.max(0, balance));
  return tokens;
}

export async function recordFreeTokenConsumption(
  client: PoolClient,
  input: {
    orgId: string;
    source: FreeTokenSource;
    requestId: string;
    feature: string;
    tokens: number;
  },
): Promise<void> {
  const tokens = Math.floor(input.tokens);
  if (tokens <= 0) return;
  try {
    await client.query(
      `INSERT INTO ai_free_token_ledger
         (org_id, source, entry_kind, tokens, feature, request_id, reason)
       VALUES ($1::uuid, $2, 'consumption', $3, $4, $5, '')
       ON CONFLICT (request_id) DO NOTHING`,
      [input.orgId, input.source, -tokens, input.feature, input.requestId],
    );
  } catch (error) {
    if (isMissingFreeTokenSchema(error)) return;
    throw error;
  }
}
