import type { PoolClient } from "@neondatabase/serverless";
import {
  CREDIT_GIFT_DEFAULT_USD,
  CREDIT_GIFT_FAMILIES,
  CREDIT_GIFT_MAX_USD,
  CREDIT_GIFT_USED_UP_BELOW_USD,
  SPONSORED_PROMO_ENDS_AT,
  SPONSORED_PROMO_TEAM_NUMBER,
  creditGiftModelLabel,
  isAllowedGiftEnvKey,
  isCreditGiftFamily,
  listGiftFundingKeys,
  type CreditGiftFamily,
  type GiftFundingKey,
} from "@vantage/billing";
import { withSavepoint } from "@vantage/db";
import { AdminRouteError, UUID_PATTERN } from "./admin-route";

/**
 * AI credit gifts as the operator sees them: every gift with its spend, what is left, which
 * models used it and how often the cap refused a call, plus the keys a new gift can draw on.
 * Spend comes from the gift ledger (settled cost + open holds), the same sum the cap uses.
 */

export const GIFT_NEAR_CAP_PERCENT = 80;

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
  /** Shown to platform admins only: the env var name or the vault label. */
  keyLabel: string;
  keyAvailable: boolean;
  status: "active" | "used_up" | "expired" | "revoked";
  byModel: Array<{ model: string; label: string; usedUsd: number; calls: number }>;
};

export type AiCreditOverview = {
  setupRequired: boolean;
  defaults: { amountUsd: number; maxUsd: number; family: CreditGiftFamily };
  families: Array<{ id: CreditGiftFamily; label: string; models: string[] }>;
  keys: GiftFundingKey[];
  gifts: AdminGift[];
  /** The hard-coded Team 1111 promo on the sponsored pool, until its end date. */
  legacyPromo: { teamNumber: number; endsAt: string; active: boolean };
};

function money(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : 0;
}

export function giftStatus(gift: {
  amountUsd: number;
  usedUsd: number;
  expiresAt: string | null;
  revokedAt: string | null;
}, now: Date = new Date()): AdminGift["status"] {
  if (gift.revokedAt) return "revoked";
  if (gift.expiresAt && Date.parse(gift.expiresAt) <= now.getTime()) return "expired";
  if (gift.amountUsd - gift.usedUsd < CREDIT_GIFT_USED_UP_BELOW_USD) return "used_up";
  return "active";
}

export function giftNearCap(gift: Pick<AdminGift, "status" | "percentUsed">): boolean {
  return gift.status === "active" && gift.percentUsed >= GIFT_NEAR_CAP_PERCENT;
}

/** Enabled keys in the platform vault (Model control). Labels and providers only. */
export async function loadVaultKeys(client: PoolClient): Promise<Array<{ id: string; provider: string; label: string }>> {
  return withSavepoint(
    client,
    async () =>
      (
        await client.query<{ id: string; provider: string; label: string }>(
          `SELECT id::text, provider, label FROM platform_provider_keys WHERE disabled_at IS NULL ORDER BY created_at DESC`,
        )
      ).rows,
    [] as Array<{ id: string; provider: string; label: string }>,
  );
}

/** The keys a new gift can draw on: provider env names that are set, plus vault keys. */
export async function listGiftKeysForAdmin(client: PoolClient, env: NodeJS.ProcessEnv = process.env): Promise<GiftFundingKey[]> {
  return listGiftFundingKeys(env, await loadVaultKeys(client));
}

export async function loadAiCreditOverview(
  client: PoolClient,
  options: { orgId?: string; env?: NodeJS.ProcessEnv; now?: Date } = {},
): Promise<AiCreditOverview> {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const keys = listGiftFundingKeys(env, await loadVaultKeys(client));
  const legacyPromo = {
    teamNumber: SPONSORED_PROMO_TEAM_NUMBER,
    endsAt: SPONSORED_PROMO_ENDS_AT.toISOString(),
    active: now.getTime() <= SPONSORED_PROMO_ENDS_AT.getTime(),
  };
  const base = {
    defaults: { amountUsd: CREDIT_GIFT_DEFAULT_USD, maxUsd: CREDIT_GIFT_MAX_USD, family: "claude" as const },
    families: Object.values(CREDIT_GIFT_FAMILIES).map((family) => ({
      id: family.id,
      label: family.label,
      models: family.models.map((model) => model.label),
    })),
    keys,
    legacyPromo,
  };

  const exists = await client.query<{ ready: boolean }>(
    `SELECT to_regclass('public.ai_credit_gifts') IS NOT NULL AS ready`,
  );
  if (exists.rows[0]?.ready !== true) return { ...base, setupRequired: true, gifts: [] };

  const [gifts, models] = await Promise.all([
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
      keySource: string;
      keyEnv: string | null;
      vaultKeyId: string | null;
    }>(
      `SELECT g.id AS "giftId", g.org_id AS "orgId", o.team_number AS "teamNumber", o.name AS "teamName",
              g.family, g.amount_usd::text AS "amountUsd",
              COALESCE(sum(CASE l.state WHEN 'settled' THEN COALESCE(l.cost_usd, 0)
                                        WHEN 'held' THEN l.reserved_usd ELSE 0 END), 0)::text AS "usedUsd",
              (count(l.id) FILTER (WHERE l.state = 'refused'))::text AS "refusedCalls",
              (count(l.id) FILTER (WHERE l.state = 'settled'))::text AS calls,
              max(l.settled_at) FILTER (WHERE l.state = 'settled')::text AS "lastUsedAt",
              g.granted_at::text AS "grantedAt", u.email AS "grantedByEmail",
              g.expires_at::text AS "expiresAt", g.revoked_at::text AS "revokedAt", g.note,
              g.key_source AS "keySource", g.key_env AS "keyEnv", g.vault_key_id::text AS "vaultKeyId"
         FROM ai_credit_gifts g
         JOIN organizations o ON o.id = g.org_id
         LEFT JOIN users u ON u.id = g.granted_by
         LEFT JOIN ai_credit_gift_ledger l ON l.gift_id = g.id
        WHERE ($1::uuid IS NULL OR g.org_id = $1::uuid)
        GROUP BY g.id, o.team_number, o.name, u.email
        ORDER BY g.revoked_at IS NOT NULL, g.granted_at DESC
        LIMIT 200`,
      [options.orgId ?? null],
    ),
    client.query<{ giftId: string; model: string | null; usedUsd: string; calls: string }>(
      `SELECT l.gift_id AS "giftId", l.model, COALESCE(sum(l.cost_usd), 0)::text AS "usedUsd", count(*)::text AS calls
         FROM ai_credit_gift_ledger l
        WHERE l.state = 'settled' AND ($1::uuid IS NULL OR l.org_id = $1::uuid)
        GROUP BY l.gift_id, l.model
        ORDER BY 3 DESC`,
      [options.orgId ?? null],
    ),
  ]);

  const byGift = new Map<string, AdminGift["byModel"]>();
  for (const row of models.rows) {
    const list = byGift.get(row.giftId) ?? [];
    list.push({
      model: row.model ?? "unknown",
      label: creditGiftModelLabel(row.model ?? "unknown"),
      usedUsd: money(row.usedUsd),
      calls: Number(row.calls) || 0,
    });
    byGift.set(row.giftId, list);
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
        const keyRef = row.keySource === "vault" ? `vault:${row.vaultKeyId ?? ""}` : `env:${row.keyEnv ?? ""}`;
        const key = keys.find((candidate) => candidate.ref === keyRef);
        const status = giftStatus({ amountUsd, usedUsd, expiresAt: row.expiresAt, revokedAt: row.revokedAt }, now);
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
          keyLabel:
            row.keySource === "vault"
              ? (key?.label ?? "Vault key (removed)")
              : (row.keyEnv ?? "Environment key"),
          keyAvailable: Boolean(key?.configured),
          status,
          byModel: byGift.get(row.giftId) ?? [],
        };
      }),
  };
}

export type GiftInput = {
  orgId: string;
  family: CreditGiftFamily;
  amountUsd: number;
  keySource: "env" | "vault";
  keyEnv: string | null;
  vaultKeyId: string | null;
  expiresAt: string | null;
  note: string | null;
};

/**
 * Check a gift before it reaches the database: a real team, a family the catalog knows, a dollar
 * amount within bounds, a funding key that exists on this deployment and fits the family, and an
 * expiry in the future. Every refusal is a sentence the operator can act on.
 */
export function parseGiftInput(
  body: Record<string, unknown>,
  keys: GiftFundingKey[],
  now: Date = new Date(),
): GiftInput {
  const orgId = typeof body.orgId === "string" ? body.orgId.trim() : "";
  if (!UUID_PATTERN.test(orgId)) throw new AdminRouteError(400, "Choose a team.");
  const family = body.family ?? "claude";
  if (!isCreditGiftFamily(family)) throw new AdminRouteError(400, "Choose which AI the credit is for.");

  const rawAmount = typeof body.amountUsd === "string" ? body.amountUsd.replace(/^\$/, "").trim() : body.amountUsd;
  const amount = rawAmount === undefined || rawAmount === "" ? CREDIT_GIFT_DEFAULT_USD : Number(rawAmount);
  if (!Number.isFinite(amount) || amount <= 0) throw new AdminRouteError(400, "Enter a dollar amount above $0.");
  if (amount > CREDIT_GIFT_MAX_USD) {
    throw new AdminRouteError(400, `A gift can be at most $${CREDIT_GIFT_MAX_USD}. Give a second one for more.`);
  }
  const amountUsd = Math.round(amount * 100) / 100;
  if (amountUsd <= 0) throw new AdminRouteError(400, "Enter at least $0.01.");

  const keyRef = typeof body.keyRef === "string" ? body.keyRef.trim() : "";
  const key = keyRef
    ? keys.find((candidate) => candidate.ref === keyRef)
    : keys.find((candidate) => candidate.family === family && candidate.configured);
  if (!key) {
    throw new AdminRouteError(
      400,
      `No ${CREDIT_GIFT_FAMILIES[family].label} key is set up to pay for this. Add ${CREDIT_GIFT_FAMILIES[family].envKeys[0]} to the deployment, or a key under Model control.`,
      "key_missing",
    );
  }
  if (key.family !== family) throw new AdminRouteError(400, "That key is for a different AI. Choose a matching key.");
  if (!key.configured) {
    throw new AdminRouteError(400, `${key.label} is not set on this deployment yet. Set it, then gift the credit.`, "key_missing");
  }
  const keySource = key.source;
  const keyEnv = keySource === "env" ? key.ref.slice("env:".length) : null;
  if (keyEnv && !isAllowedGiftEnvKey(family, keyEnv)) throw new AdminRouteError(400, "That key can't pay for this AI.");
  const vaultKeyId = keySource === "vault" ? key.ref.slice("vault:".length) : null;

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

  return { orgId, family, amountUsd, keySource, keyEnv, vaultKeyId, expiresAt, note: note || null };
}

export async function grantGift(client: PoolClient, input: GiftInput): Promise<string> {
  const result = await client.query<{ id: string }>(
    `SELECT grant_ai_credit_gift($1::uuid, $2::text, $3::numeric, $4::text, $5::text, $6::uuid, $7::timestamptz, $8::text) AS id`,
    [input.orgId, input.family, input.amountUsd.toFixed(2), input.keySource, input.keyEnv, input.vaultKeyId, input.expiresAt, input.note],
  );
  return result.rows[0]!.id;
}

export async function revokeGift(client: PoolClient, giftId: string): Promise<void> {
  await client.query(`SELECT revoke_ai_credit_gift($1::uuid)`, [giftId]);
}

/** Map a 0727 refusal (`vantage:<code>` detail) to a sentence. */
export function giftRefusal(error: unknown): AdminRouteError | null {
  if (!error || typeof error !== "object") return null;
  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  if (code === "42883" || code === "42P01") {
    return new AdminRouteError(503, "AI credit needs database migration 0727. Run the migrations, then try again.", "setup_required");
  }
  const detail = "detail" in error ? String((error as { detail?: unknown }).detail ?? "") : "";
  switch (detail) {
    case "vantage:not_found":
      return new AdminRouteError(404, "That team or gift is gone. Refresh the page.", "not_found");
    case "vantage:key_missing":
      return new AdminRouteError(400, "That vault key was removed. Choose another key.", "key_missing");
    case "vantage:key_provider":
      return new AdminRouteError(400, "That key is for a different AI. Choose a matching key.", "key_provider");
    default:
      return null;
  }
}
