import type { PoolClient } from "@neondatabase/serverless";
import {
  CREDIT_GIFT_DEFAULT_USD,
  CREDIT_GIFT_FAMILIES,
  CREDIT_GIFT_MAX_USD,
  CREDIT_GIFT_USED_UP_BELOW_USD,
  SPONSORED_PROMO_ENDS_AT,
  SPONSORED_PROMO_TEAM_NUMBER,
  creditGiftModelLabel,
  giftEnvKeyConfigured,
  giftEnvKeyNames,
  isAllowedGiftEnvKey,
  isCreditGiftFamily,
  providerFamily,
  type CreditGiftFamily,
} from "@vantage/billing";
import { withSavepoint } from "@vantage/db";
import { AdminRouteError, UUID_PATTERN } from "./admin-route";

/**
 * AI credit as the operator sees it: every gift with its spend, what is left, which models and
 * which of the operator's keys served it and how often the cap refused a call, plus the key pool
 * that pays for gifts. Spend comes from the gift ledger (settled cost + open holds), the same sum
 * the cap uses. Keys are shown by label and env var name (operators may see names); a secret is
 * never read here and never leaves the server.
 */

export const GIFT_NEAR_CAP_PERCENT = 80;

export type PoolKey = {
  id: string;
  family: CreditGiftFamily;
  provider: string;
  label: string;
  source: "env" | "vault";
  /** The env var a row references (operators only), or null for a vault key. */
  envName: string | null;
  /** A vault key always has its secret; an env row only when the variable is set here. */
  configured: boolean;
  enabled: boolean;
  priority: number;
  lastUsedAt: string | null;
  degradedAt: string | null;
  degradedReason: string | null;
  usedUsd: number;
  calls: number;
};

export type KeyPool = {
  /** False before migration 0727: the pool has one key per row and no order yet. */
  ready: boolean;
  keys: PoolKey[];
  /** Provider-key env vars set on this deployment that are not in the pool yet. */
  unlisted: Array<{ family: CreditGiftFamily; name: string }>;
};

export type AdminGift = {
  giftId: string;
  orgId: string;
  teamNumber: number | null;
  teamName: string;
  family: CreditGiftFamily;
  familyLabel: string;
  amountUsd: number;
  usedUsd: number;
  remainingUsd: number;
  percentUsed: number;
  refusedCalls: number;
  calls: number;
  lastUsedAt: string | null;
  grantedAt: string;
  grantedByEmail: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  note: string | null;
  status: "active" | "used_up" | "expired" | "revoked";
  byModel: Array<{ model: string; label: string; usedUsd: number; calls: number }>;
  byKey: Array<{ label: string; usedUsd: number; calls: number }>;
};

export type AiCreditOverview = {
  setupRequired: boolean;
  defaults: { amountUsd: number; maxUsd: number; family: CreditGiftFamily };
  families: Array<{ id: CreditGiftFamily; label: string; models: string[]; payable: boolean }>;
  pool: KeyPool;
  gifts: AdminGift[];
  /** The hard-coded Team 1111 promo on the sponsored pool, until its end date. */
  legacyPromo: { teamNumber: number; endsAt: string; active: boolean };
};

function money(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : 0;
}

export function giftStatus(
  gift: { amountUsd: number; usedUsd: number; expiresAt: string | null; revokedAt: string | null },
  now: Date = new Date(),
): AdminGift["status"] {
  if (gift.revokedAt) return "revoked";
  if (gift.expiresAt && Date.parse(gift.expiresAt) <= now.getTime()) return "expired";
  if (gift.amountUsd - gift.usedUsd < CREDIT_GIFT_USED_UP_BELOW_USD) return "used_up";
  return "active";
}

export function giftNearCap(gift: Pick<AdminGift, "status" | "percentUsed">): boolean {
  return gift.status === "active" && gift.percentUsed >= GIFT_NEAR_CAP_PERCENT;
}

async function schemaReady(client: PoolClient): Promise<boolean> {
  const result = await client.query<{ ready: boolean }>(
    `SELECT to_regclass('public.ai_credit_gifts') IS NOT NULL AS ready`,
  );
  return result.rows[0]?.ready === true;
}

/**
 * The operator's key pool, in routing order. Read through to_jsonb so the page still lists the
 * vault before migration 0727 adds the order, the env reference and the degraded mark.
 */
export async function loadKeyPool(client: PoolClient, env: NodeJS.ProcessEnv = process.env): Promise<KeyPool> {
  const ready = await schemaReady(client);
  const rows = await withSavepoint(
    client,
    async () =>
      (
        await client.query<{
          id: string;
          provider: string;
          label: string;
          envName: string | null;
          enabled: boolean;
          priority: number;
          lastUsedAt: string | null;
          degradedAt: string | null;
          degradedReason: string | null;
        }>(
          `SELECT k.id::text, k.provider, k.label,
                  to_jsonb(k) ->> 'key_env' AS "envName",
                  k.disabled_at IS NULL AS enabled,
                  COALESCE((to_jsonb(k) ->> 'priority')::int, 100) AS priority,
                  k.last_used_at::text AS "lastUsedAt",
                  to_jsonb(k) ->> 'degraded_at' AS "degradedAt",
                  to_jsonb(k) ->> 'degraded_reason' AS "degradedReason"
             FROM platform_provider_keys k
            ORDER BY lower(k.provider), COALESCE((to_jsonb(k) ->> 'priority')::int, 100), k.created_at`,
        )
      ).rows,
    [],
  );
  const usage = ready
    ? await withSavepoint(
        client,
        async () =>
          (
            await client.query<{ keyId: string; usedUsd: string; calls: string }>(
              `SELECT key_id::text AS "keyId", COALESCE(sum(cost_usd), 0)::text AS "usedUsd", count(*)::text AS calls
                 FROM ai_credit_gift_ledger WHERE state = 'settled' AND key_id IS NOT NULL GROUP BY key_id`,
            )
          ).rows,
        [],
      )
    : [];
  const byKey = new Map(usage.map((row) => [row.keyId, row]));

  const keys: PoolKey[] = [];
  for (const row of rows) {
    const family = providerFamily(row.provider);
    if (!family) continue;
    const spent = byKey.get(row.id);
    keys.push({
      id: row.id,
      family,
      provider: row.provider,
      label: row.label,
      source: row.envName ? "env" : "vault",
      envName: row.envName,
      configured: row.envName ? giftEnvKeyConfigured(row.envName, env) : true,
      enabled: row.enabled,
      priority: Number(row.priority) || 0,
      lastUsedAt: row.lastUsedAt,
      degradedAt: row.degradedAt,
      degradedReason: row.degradedReason,
      usedUsd: money(spent?.usedUsd ?? 0),
      calls: Number(spent?.calls ?? 0) || 0,
    });
  }

  const listed = new Set(keys.map((key) => key.envName).filter(Boolean));
  const unlisted: KeyPool["unlisted"] = [];
  for (const family of Object.keys(CREDIT_GIFT_FAMILIES) as CreditGiftFamily[]) {
    for (const name of giftEnvKeyNames(family, env)) {
      if (!listed.has(name) && giftEnvKeyConfigured(name, env)) unlisted.push({ family, name });
    }
  }
  return { ready, keys, unlisted };
}

/** Whether the pool can pay for a family right now: a switched-on key with its secret here. */
export function poolCanPay(pool: KeyPool, family: CreditGiftFamily): boolean {
  return pool.keys.some((key) => key.family === family && key.enabled && key.configured);
}

export async function loadAiCreditOverview(
  client: PoolClient,
  options: { orgId?: string; env?: NodeJS.ProcessEnv; now?: Date } = {},
): Promise<AiCreditOverview> {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const pool = await loadKeyPool(client, env);
  const base = {
    defaults: { amountUsd: CREDIT_GIFT_DEFAULT_USD, maxUsd: CREDIT_GIFT_MAX_USD, family: "claude" as const },
    families: Object.values(CREDIT_GIFT_FAMILIES).map((family) => ({
      id: family.id,
      label: family.label,
      models: family.models.map((model) => model.label),
      payable: poolCanPay(pool, family.id),
    })),
    pool,
    legacyPromo: {
      teamNumber: SPONSORED_PROMO_TEAM_NUMBER,
      endsAt: SPONSORED_PROMO_ENDS_AT.toISOString(),
      active: now.getTime() <= SPONSORED_PROMO_ENDS_AT.getTime(),
    },
  };
  if (!pool.ready) return { ...base, setupRequired: true, gifts: [] };

  const orgFilter = options.orgId ?? null;
  const [gifts, models, keys] = await Promise.all([
    client.query<{
      giftId: string;
      orgId: string;
      teamNumber: number | null;
      teamName: string;
      family: string;
      amountUsd: string;
      usedUsd: string;
      refusedCalls: string;
      calls: string;
      lastUsedAt: string | null;
      grantedAt: string;
      grantedByEmail: string | null;
      expiresAt: string | null;
      revokedAt: string | null;
      note: string | null;
    }>(
      `SELECT g.id AS "giftId", g.org_id AS "orgId", o.team_number AS "teamNumber", o.name AS "teamName",
              g.family, g.amount_usd::text AS "amountUsd",
              COALESCE(sum(CASE l.state WHEN 'settled' THEN COALESCE(l.cost_usd, 0)
                                        WHEN 'held' THEN l.reserved_usd ELSE 0 END), 0)::text AS "usedUsd",
              (count(l.id) FILTER (WHERE l.state = 'refused'))::text AS "refusedCalls",
              (count(l.id) FILTER (WHERE l.state = 'settled'))::text AS calls,
              (max(l.settled_at) FILTER (WHERE l.state = 'settled'))::text AS "lastUsedAt",
              g.granted_at::text AS "grantedAt", u.email AS "grantedByEmail",
              g.expires_at::text AS "expiresAt", g.revoked_at::text AS "revokedAt", g.note
         FROM ai_credit_gifts g
         JOIN organizations o ON o.id = g.org_id
         LEFT JOIN users u ON u.id = g.granted_by
         LEFT JOIN ai_credit_gift_ledger l ON l.gift_id = g.id
        WHERE ($1::uuid IS NULL OR g.org_id = $1::uuid)
        GROUP BY g.id, o.team_number, o.name, u.email
        ORDER BY g.revoked_at IS NOT NULL, g.granted_at DESC
        LIMIT 200`,
      [orgFilter],
    ),
    client.query<{ giftId: string; model: string | null; usedUsd: string; calls: string }>(
      `SELECT l.gift_id AS "giftId", l.model, COALESCE(sum(l.cost_usd), 0)::text AS "usedUsd", count(*)::text AS calls
         FROM ai_credit_gift_ledger l
        WHERE l.state = 'settled' AND ($1::uuid IS NULL OR l.org_id = $1::uuid)
        GROUP BY l.gift_id, l.model
        ORDER BY 3 DESC`,
      [orgFilter],
    ),
    client.query<{ giftId: string; label: string | null; usedUsd: string; calls: string }>(
      `SELECT l.gift_id AS "giftId", l.key_label AS label, COALESCE(sum(l.cost_usd), 0)::text AS "usedUsd", count(*)::text AS calls
         FROM ai_credit_gift_ledger l
        WHERE l.state = 'settled' AND ($1::uuid IS NULL OR l.org_id = $1::uuid)
        GROUP BY l.gift_id, l.key_label
        ORDER BY 3 DESC`,
      [orgFilter],
    ),
  ]);

  const modelsByGift = new Map<string, AdminGift["byModel"]>();
  for (const row of models.rows) {
    const list = modelsByGift.get(row.giftId) ?? [];
    list.push({
      model: row.model ?? "unknown",
      label: creditGiftModelLabel(row.model ?? "unknown"),
      usedUsd: money(row.usedUsd),
      calls: Number(row.calls) || 0,
    });
    modelsByGift.set(row.giftId, list);
  }
  const keysByGift = new Map<string, AdminGift["byKey"]>();
  for (const row of keys.rows) {
    const list = keysByGift.get(row.giftId) ?? [];
    list.push({ label: row.label ?? "Removed key", usedUsd: money(row.usedUsd), calls: Number(row.calls) || 0 });
    keysByGift.set(row.giftId, list);
  }

  return {
    ...base,
    setupRequired: false,
    gifts: gifts.rows
      .filter((row) => isCreditGiftFamily(row.family))
      .map((row) => {
        const family = row.family as CreditGiftFamily;
        const amountUsd = money(row.amountUsd);
        const usedUsd = Math.min(amountUsd, money(row.usedUsd));
        return {
          giftId: row.giftId,
          orgId: row.orgId,
          teamNumber: row.teamNumber,
          teamName: row.teamName,
          family,
          familyLabel: CREDIT_GIFT_FAMILIES[family].label,
          amountUsd,
          usedUsd,
          remainingUsd: money(Math.max(0, amountUsd - usedUsd)),
          percentUsed: amountUsd > 0 ? Math.min(100, Math.round((usedUsd / amountUsd) * 1000) / 10) : 0,
          refusedCalls: Number(row.refusedCalls) || 0,
          calls: Number(row.calls) || 0,
          lastUsedAt: row.lastUsedAt,
          grantedAt: row.grantedAt,
          grantedByEmail: row.grantedByEmail,
          expiresAt: row.expiresAt,
          revokedAt: row.revokedAt,
          note: row.note,
          status: giftStatus({ amountUsd, usedUsd, expiresAt: row.expiresAt, revokedAt: row.revokedAt }, now),
          byModel: modelsByGift.get(row.giftId) ?? [],
          byKey: keysByGift.get(row.giftId) ?? [],
        };
      }),
  };
}

export type GiftInput = {
  orgId: string;
  family: CreditGiftFamily;
  amountUsd: number;
  expiresAt: string | null;
  note: string | null;
};

/**
 * Check a gift before it reaches the database: a real team id, a family the catalog knows, a
 * dollar amount within bounds, a pool that can pay for it, and an expiry in the future. Every
 * refusal is a sentence the operator can act on.
 */
export function parseGiftInput(body: Record<string, unknown>, pool: KeyPool, now: Date = new Date()): GiftInput {
  const orgId = typeof body.orgId === "string" ? body.orgId.trim() : "";
  if (!UUID_PATTERN.test(orgId)) throw new AdminRouteError(400, "Choose a team.");
  const family = body.family ?? "claude";
  if (!isCreditGiftFamily(family)) throw new AdminRouteError(400, "Choose which AI the credit is for.");

  const rawAmount = typeof body.amountUsd === "string" ? body.amountUsd.replace(/^\$/, "").trim() : body.amountUsd;
  const amount = rawAmount === undefined || rawAmount === null || rawAmount === "" ? CREDIT_GIFT_DEFAULT_USD : Number(rawAmount);
  if (!Number.isFinite(amount) || amount <= 0) throw new AdminRouteError(400, "Enter a dollar amount above $0.");
  if (amount > CREDIT_GIFT_MAX_USD) {
    throw new AdminRouteError(400, `A gift can be at most $${CREDIT_GIFT_MAX_USD}. Give a second one for more.`);
  }
  const amountUsd = Math.round(amount * 100) / 100;
  if (amountUsd <= 0) throw new AdminRouteError(400, "Enter at least $0.01.");

  if (!poolCanPay(pool, family)) {
    const info = CREDIT_GIFT_FAMILIES[family];
    throw new AdminRouteError(
      400,
      `No ${info.label} key is switched on to pay for this. Add one under "Keys that pay for AI credit" (for example ${info.envKeys[0]}), then give the credit.`,
      "key_missing",
    );
  }

  let expiresAt: string | null = null;
  if (typeof body.expiresAt === "string" && body.expiresAt.trim()) {
    const raw = body.expiresAt.trim();
    // A bare date means the end of that day, UTC.
    const parsed = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T23:59:59Z` : raw);
    if (!Number.isFinite(parsed)) throw new AdminRouteError(400, "Enter the end date as a date.");
    if (parsed <= now.getTime()) throw new AdminRouteError(400, "Choose an end date in the future, or leave it empty.");
    expiresAt = new Date(parsed).toISOString();
  }

  const note = typeof body.note === "string" ? body.note.trim().replace(/\s+/g, " ") : "";
  if (note.length > 280) throw new AdminRouteError(400, "Keep the note to 280 characters.");

  return { orgId, family, amountUsd, expiresAt, note: note || null };
}

export async function grantGift(client: PoolClient, input: GiftInput): Promise<string> {
  const result = await client.query<{ id: string }>(
    `SELECT grant_ai_credit_gift($1::uuid, $2::text, $3::numeric, $4::timestamptz, $5::text) AS id`,
    [input.orgId, input.family, input.amountUsd.toFixed(2), input.expiresAt, input.note],
  );
  return result.rows[0]!.id;
}

export async function revokeGift(client: PoolClient, giftId: string): Promise<void> {
  await client.query(`SELECT revoke_ai_credit_gift($1::uuid)`, [giftId]);
}

/** Map a 0727 refusal (`vantage:<code>` detail, or a missing migration) to a sentence. */
export function giftRefusal(error: unknown): AdminRouteError | null {
  if (!error || typeof error !== "object") return null;
  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  if (code === "42883" || code === "42P01" || code === "42703") {
    return new AdminRouteError(503, "AI credit needs database migration 0727. Run the migrations, then try again.", "setup_required");
  }
  if (code === "23514") {
    return new AdminRouteError(400, "That key can't be saved: use a provider key name, and either a pasted key or a name, not both.", "invalid_key");
  }
  const detail = "detail" in error ? String((error as { detail?: unknown }).detail ?? "") : "";
  switch (detail) {
    case "vantage:not_found":
      return new AdminRouteError(404, "That team or gift is gone. Refresh the page.", "not_found");
    case "vantage:key_missing":
      return new AdminRouteError(400, "No key in the pool can pay for this AI. Add or switch on a key first.", "key_missing");
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Managing the pool
// ---------------------------------------------------------------------------------------------

export type PoolKeyAdd =
  | { kind: "env"; family: CreditGiftFamily; envName: string; label: string }
  | { kind: "vault"; family: CreditGiftFamily; secret: string; label: string };

const PROVIDER_FOR_FAMILY: Record<CreditGiftFamily, string> = { claude: "anthropic", openai: "openai", gemini: "google" };

export function providerForFamily(family: CreditGiftFamily): string {
  return PROVIDER_FOR_FAMILY[family];
}

export function parsePoolKeyAdd(body: Record<string, unknown>): PoolKeyAdd {
  const family = body.family;
  if (!isCreditGiftFamily(family)) throw new AdminRouteError(400, "Choose which AI the key is for.");
  const label = typeof body.label === "string" ? body.label.trim().replace(/\s+/g, " ") : "";
  if (!label) throw new AdminRouteError(400, "Give the key a name you'll recognise, like \"Main Anthropic\".");
  if (label.length > 80) throw new AdminRouteError(400, "Keep the name to 80 characters.");
  if (typeof body.envName === "string" && body.envName.trim()) {
    const envName = body.envName.trim();
    if (!isAllowedGiftEnvKey(family, envName)) {
      throw new AdminRouteError(
        400,
        `Use ${CREDIT_GIFT_FAMILIES[family].envKeys.join(" or ")}, or a name starting VANTAGE_GIFT_${providerForFamily(family).toUpperCase()}_.`,
      );
    }
    return { kind: "env", family, envName, label };
  }
  const secret = typeof body.secret === "string" ? body.secret.trim() : "";
  if (secret.length < 8) throw new AdminRouteError(400, "Paste the API key, or name an environment variable instead.");
  return { kind: "vault", family, secret, label };
}
