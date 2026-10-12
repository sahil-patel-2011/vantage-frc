/**
 * AI credit a platform admin gifts a team, paid from the operator's own provider keys.
 *
 * The rules (migration 0727):
 * - A gift is a dollar amount on one model family, paid from the operator's key pool for that
 *   provider (`platform_provider_keys`): any number of keys, each an encrypted vault key or a
 *   provider-key environment variable named by the operator (ANTHROPIC_API_KEY, or
 *   VANTAGE_GIFT_ANTHROPIC_<LABEL> for more than one), tried in the operator's order. A key never
 *   leaves the server and is never stored in plain text.
 * - Spend is summed from the gift's own ledger (`ai_credit_gift_ledger`), never a counter.
 * - Before each provider call the call's worst-case cost is reserved in its own short, committed
 *   transaction that holds the gift row lock (`reserve_ai_credit_gift`). A call that could cross
 *   the gift is refused there. After the call the hold settles at the real cost, or is released
 *   when the provider refused the call. So spend never exceeds the gift.
 *
 * This file is the pure arithmetic plus thin wrappers over the 0727 functions. The chat adapter
 * that spends a gift lives in @vantage/agent (credit-gift-adapter.ts).
 */
import type { PoolClient } from "@neondatabase/serverless";
import { withRls } from "@vantage/db";

/**
 * The provider name a gift-funded chat adapter reports. meteredAI reads it (like
 * "subscription-bridge") to meter the call as `gift`: the operator's key pays, the team is
 * charged nothing, and the gift's own ledger enforces the cap.
 */
export const CREDIT_GIFT_PROVIDER = "vantage-gift";

export type CreditGiftFamily = "claude" | "openai" | "gemini";
export type CreditGiftProvider = "anthropic" | "openai" | "google";

export type CreditGiftPrices = {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  cacheReadPerMillionUsd?: number;
  cacheWritePerMillionUsd?: number;
};

export type CreditGiftModel = {
  modelId: string;
  label: string;
  /** "everyday" answers most asks; "hard" is used for tasks the router classifies as hard. */
  role: "everyday" | "hard";
  prices: CreditGiftPrices;
  /** Anthropic effort for models that take it (Claude Haiku 5.5). */
  effort?: "low" | "medium" | "high";
};

export type CreditGiftFamilyInfo = {
  id: CreditGiftFamily;
  label: string;
  provider: CreditGiftProvider;
  /** The standard environment names this family can be funded from, in preference order. */
  envKeys: readonly string[];
  models: readonly [CreditGiftModel, ...CreditGiftModel[]];
};

/**
 * Model families a gift can cover, with public list prices. Claude rates are Anthropic's list
 * prices as of 2026-10-06 (cache writes at 1.25x input, cache reads as published); OpenAI and
 * Gemini rates mirror the BYOK snapshot in packages/agent/src/byok-model-routing.ts.
 */
export const CREDIT_GIFT_FAMILIES: Readonly<Record<CreditGiftFamily, CreditGiftFamilyInfo>> = {
  claude: {
    id: "claude",
    label: "Claude Haiku 5.5",
    provider: "anthropic",
    envKeys: ["ANTHROPIC_API_KEY"],
    // One model for every ask: Medium effort by default, High for what the router calls hard.
    // Rates are for prompts up to 100K tokens; longer prompts are billed at 5x
    // (pricesForPrompt in packages/agent/src/http-chat-adapter.ts).
    models: [
      {
        modelId: "claude-haiku-5-5",
        label: "Claude Haiku 5.5",
        role: "everyday",
        effort: "medium",
        prices: { inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.5, cacheReadPerMillionUsd: 0.01, cacheWritePerMillionUsd: 0.125 },
      },
      {
        modelId: "claude-haiku-5-5",
        label: "Claude Haiku 5.5 (High effort)",
        role: "hard",
        effort: "high",
        prices: { inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.5, cacheReadPerMillionUsd: 0.01, cacheWritePerMillionUsd: 0.125 },
      },
    ],
  },
  openai: {
    id: "openai",
    label: "OpenAI GPT-4.1",
    provider: "openai",
    envKeys: ["OPENAI_API_KEY"],
    models: [
      { modelId: "gpt-4.1-mini", label: "GPT-4.1 mini", role: "everyday", prices: { inputPerMillionUsd: 0.4, outputPerMillionUsd: 1.6 } },
      { modelId: "gpt-4.1", label: "GPT-4.1", role: "hard", prices: { inputPerMillionUsd: 2, outputPerMillionUsd: 8 } },
    ],
  },
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    provider: "google",
    envKeys: ["GOOGLE_AI_API_KEY", "GEMINI_API_KEY"],
    models: [
      { modelId: "gemini-3.8-flash", label: "Gemini 3.8 Flash", role: "everyday", prices: { inputPerMillionUsd: 0.75, outputPerMillionUsd: 3.75 } },
      { modelId: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", role: "hard", prices: { inputPerMillionUsd: 2, outputPerMillionUsd: 12 } },
    ],
  },
};

export const CREDIT_GIFT_DEFAULT_USD = 10;
export const CREDIT_GIFT_MAX_USD = 1000;
/** Below this much left, a gift counts as used up (it could not pay for a short reply). */
export const CREDIT_GIFT_USED_UP_BELOW_USD = 0.05;

export function isCreditGiftFamily(value: unknown): value is CreditGiftFamily {
  return value === "claude" || value === "openai" || value === "gemini";
}

/** Extra operator keys: VANTAGE_GIFT_ANTHROPIC_<LABEL>, VANTAGE_GIFT_OPENAI_<LABEL>, VANTAGE_GIFT_GOOGLE_<LABEL>. */
const EXTRA_KEY_PATTERN: Record<CreditGiftProvider, RegExp> = {
  anthropic: /^VANTAGE_GIFT_ANTHROPIC_[A-Z0-9_]{1,40}$/,
  openai: /^VANTAGE_GIFT_OPENAI_[A-Z0-9_]{1,40}$/,
  google: /^VANTAGE_GIFT_GOOGLE_[A-Z0-9_]{1,40}$/,
};

/**
 * Whether a gift for `family` may be funded from the env var `name`. Only provider-key names
 * qualify, so a gift can never point the runtime at another secret (BETTER_AUTH_SECRET, a
 * database URL) and send it to a provider as an API key.
 */
export function isAllowedGiftEnvKey(family: CreditGiftFamily, name: string): boolean {
  const info = CREDIT_GIFT_FAMILIES[family];
  return info.envKeys.includes(name) || EXTRA_KEY_PATTERN[info.provider].test(name);
}

function envValue(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim() ?? "";
  return value === "[SENSITIVE]" ? "" : value;
}

/** Every provider-key environment name a pool row may reference for this family's provider. */
export function giftEnvKeyNames(family: CreditGiftFamily, env: NodeJS.ProcessEnv = process.env): string[] {
  const info = CREDIT_GIFT_FAMILIES[family];
  const names = new Set<string>(info.envKeys);
  for (const name of Object.keys(env)) if (EXTRA_KEY_PATTERN[info.provider].test(name)) names.add(name);
  return [...names].sort();
}

/** Whether an env-referenced pool key has a value on this deployment (never the value itself). */
export function giftEnvKeyConfigured(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(envValue(env, name));
}

export function providerFamily(provider: string): CreditGiftFamily | null {
  const p = provider.trim().toLowerCase();
  if (p === "anthropic" || p === "claude") return "claude";
  if (p === "openai") return "openai";
  if (p === "google" || p === "gemini") return "gemini";
  return null;
}

// ---------------------------------------------------------------------------------------------
// Cap arithmetic. Money moves in whole micro-dollars (numeric(12,6) in Postgres), so there is no
// floating-point drift between what is checked here and what the ledger sums.
// ---------------------------------------------------------------------------------------------

const MICROS = 1_000_000;

/** USD to whole micro-dollars, rounding UP: a reservation is never smaller than the cost it covers. */
export function usdToMicrosCeil(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  // The small epsilon absorbs binary noise (0.1 * 1e6 = 100000.00000000001) without rounding a
  // real fraction of a micro-dollar down.
  return Math.ceil(usd * MICROS - 1e-6);
}

/** Nearest micro-dollar: how Postgres stores a numeric(12,6) amount. */
export function usdToMicros(usd: number): number {
  if (!Number.isFinite(usd)) return 0;
  return Math.round(usd * MICROS);
}

export function microsToUsd(micros: number): number {
  return micros / MICROS;
}

/** The amount sent to reserve_ai_credit_gift: whole micro-dollars, rounded up. */
export function reservationUsd(usd: number): number {
  return microsToUsd(usdToMicrosCeil(usd));
}

export type GiftReservationDecision = {
  allowed: boolean;
  remainingUsd: number;
  /** Spend (settled + held) after this reservation, when allowed. */
  spentAfterUsd: number;
};

/**
 * The check reserve_ai_credit_gift makes, in the same units: allowed exactly when what is
 * already spent or held plus this request fits inside the gift. Reaching the cap exactly is
 * allowed; one micro-dollar over is not.
 */
export function evaluateGiftReservation(input: {
  amountUsd: number;
  spentUsd: number;
  requestUsd: number;
}): GiftReservationDecision {
  const amount = usdToMicros(input.amountUsd);
  const spent = usdToMicros(input.spentUsd);
  const request = usdToMicrosCeil(input.requestUsd);
  const allowed = spent + request <= amount;
  return {
    allowed,
    remainingUsd: microsToUsd(Math.max(0, amount - spent)),
    spentAfterUsd: microsToUsd(allowed ? spent + request : spent),
  };
}

/** Tokens added to every bound for framing a request (roles, tool-use preamble, wrappers). */
export const GIFT_REQUEST_OVERHEAD_TOKENS = 1024;

/**
 * The most one call can cost. A byte-level tokenizer never makes more tokens than the UTF-8
 * bytes it reads, so the request's byte length (plus a fixed allowance for framing) bounds its
 * input tokens; max_tokens bounds its output, thinking included. Input is priced at the higher
 * of the plain and cache-write rates, since a call may write the prompt cache.
 */
export function giftCallCeilingUsd(input: {
  inputBytes: number;
  maxOutputTokens: number;
  prices: CreditGiftPrices;
}): number {
  const inputTokens = Math.max(0, Math.ceil(input.inputBytes)) + GIFT_REQUEST_OVERHEAD_TOKENS;
  const inputRate = Math.max(input.prices.inputPerMillionUsd, input.prices.cacheWritePerMillionUsd ?? 0);
  const usd =
    (inputTokens * inputRate + Math.max(0, Math.ceil(input.maxOutputTokens)) * input.prices.outputPerMillionUsd) /
    1_000_000;
  return reservationUsd(usd);
}

export function creditGiftModelFor(
  family: CreditGiftFamily,
  difficulty?: "easy" | "medium" | "hard" | string,
): CreditGiftModel {
  const models = CREDIT_GIFT_FAMILIES[family].models;
  if (difficulty === "hard") return models.find((m) => m.role === "hard") ?? models[0];
  return models.find((m) => m.role === "everyday") ?? models[0];
}

export function creditGiftModelLabel(modelId: string): string {
  for (const info of Object.values(CREDIT_GIFT_FAMILIES)) {
    const match = info.models.find((m) => m.modelId === modelId);
    if (match) return match.label;
  }
  return modelId;
}

// ---------------------------------------------------------------------------------------------
// Runtime: the gift a team's Ask AI draws on, and its ledger.
// ---------------------------------------------------------------------------------------------

export type ActiveCreditGift = {
  giftId: string;
  family: CreditGiftFamily;
  amountUsd: number;
  spentUsd: number;
  expiresAt: string | null;
};

/** Whether a gift still has enough left to try a call (a smaller balance counts as used up). */
export function creditGiftUsable(gift: Pick<ActiveCreditGift, "amountUsd" | "spentUsd">): boolean {
  return gift.amountUsd - gift.spentUsd >= CREDIT_GIFT_USED_UP_BELOW_USD;
}

/**
 * The gift this team's AI should use now, or null. `ai_credit_gift_for_org` returns nothing to
 * non-members and leaves revoked and expired gifts out.
 */
export async function loadActiveCreditGift(client: PoolClient, orgId: string): Promise<ActiveCreditGift | null> {
  const result = await client.query<{
    giftId: string;
    family: string;
    amountUsd: string;
    spentUsd: string;
    expiresAt: string | null;
  }>(
    `SELECT gift_id AS "giftId", family, amount_usd::text AS "amountUsd", spent_usd::text AS "spentUsd",
            expires_at::text AS "expiresAt"
       FROM ai_credit_gift_for_org($1::uuid)`,
    [orgId],
  );
  const row = result.rows[0];
  if (!row || !isCreditGiftFamily(row.family)) return null;
  return {
    giftId: row.giftId,
    family: row.family,
    amountUsd: Number(row.amountUsd),
    spentUsd: Number(row.spentUsd),
    expiresAt: row.expiresAt,
  };
}

export type PoolKeyEnvelope = {
  keyCiphertext: string;
  keyNonce: string;
  keyAuthTag: string;
  encryptedDek: string;
  kmsKeyId: string;
};

/** One switched-on key in the operator's pool for a gift, in order. Server-side only. */
export type GiftPoolKey = {
  keyId: string;
  label: string;
  keyEnv: string | null;
  envelope: PoolKeyEnvelope | null;
};

export async function loadCreditGiftKeys(client: PoolClient, giftId: string): Promise<GiftPoolKey[]> {
  const result = await client.query<{
    keyId: string;
    label: string;
    keyEnv: string | null;
    keyCiphertext: string | null;
    keyNonce: string | null;
    keyAuthTag: string | null;
    encryptedDek: string | null;
    kmsKeyId: string | null;
  }>(
    `SELECT key_id AS "keyId", label, key_env AS "keyEnv", key_ciphertext AS "keyCiphertext",
            key_nonce AS "keyNonce", key_auth_tag AS "keyAuthTag", encrypted_dek AS "encryptedDek",
            kms_key_id AS "kmsKeyId"
       FROM ai_credit_gift_keys($1::uuid)`,
    [giftId],
  );
  return result.rows.map((row) => ({
    keyId: row.keyId,
    label: row.label,
    keyEnv: row.keyEnv,
    envelope:
      row.keyCiphertext && row.keyNonce && row.keyAuthTag && row.encryptedDek && row.kmsKeyId
        ? {
            keyCiphertext: row.keyCiphertext,
            keyNonce: row.keyNonce,
            keyAuthTag: row.keyAuthTag,
            encryptedDek: row.encryptedDek,
            kmsKeyId: row.kmsKeyId,
          }
        : null,
  }));
}

/**
 * The secret behind one pool key, or null when it is not usable on this deployment (its env var
 * is unset or not a provider-key name, or the envelope does not decrypt). Server-side only.
 */
export async function resolvePoolKeySecret(
  family: CreditGiftFamily,
  key: GiftPoolKey,
  decrypt: (envelope: PoolKeyEnvelope) => Promise<string>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  if (key.keyEnv) {
    if (!isAllowedGiftEnvKey(family, key.keyEnv)) return null;
    return envValue(env, key.keyEnv) || null;
  }
  if (!key.envelope) return null;
  try {
    return (await decrypt(key.envelope)).trim() || null;
  } catch {
    return null;
  }
}

export type GiftReserveResult = {
  holdId: string | null;
  outcome: "held" | "refused" | "inactive";
  amountUsd: number;
  spentUsd: number;
};

export type GiftAlert = "80" | "exhausted";

/** Reserve and settle in transactions of their own, so concurrent calls see each other's holds. */
export type CreditGiftLedger = {
  reserve(input: { giftId: string; amountUsd: number; model: string; feature: string }): Promise<GiftReserveResult>;
  settle(input: {
    holdId: string;
    costUsd: number;
    promptTokens: number;
    completionTokens: number;
    released: boolean;
    /** The pool key that answered, recorded on the ledger row (id only; the label is looked up). */
    keyId?: string | null;
  }): Promise<GiftAlert | null>;
  /** A pool key turned the call away: mark it degraded for module health. */
  noteKeyFailure(input: { giftId: string; keyId: string; reason: string }): Promise<void>;
};

type CommittedRunner = <T>(work: (client: PoolClient) => Promise<T>) => Promise<T>;

export function createCreditGiftLedger(
  context: { userId: string; orgId: string },
  run: CommittedRunner = (work) => withRls(context, work),
): CreditGiftLedger {
  return {
    async reserve(input) {
      return run(async (client) => {
        const result = await client.query<{ holdId: string | null; outcome: string; amountUsd: string; spentUsd: string }>(
          `SELECT hold_id AS "holdId", outcome, amount_usd::text AS "amountUsd", spent_usd::text AS "spentUsd"
             FROM reserve_ai_credit_gift($1::uuid, $2::numeric, $3::text, $4::text)`,
          [input.giftId, reservationUsd(input.amountUsd).toFixed(6), input.model, input.feature],
        );
        const row = result.rows[0];
        const outcome = row?.outcome === "held" || row?.outcome === "refused" ? row.outcome : "inactive";
        return {
          holdId: row?.holdId ?? null,
          outcome,
          amountUsd: Number(row?.amountUsd ?? 0),
          spentUsd: Number(row?.spentUsd ?? 0),
        };
      });
    },
    async settle(input) {
      return run(async (client) => {
        const result = await client.query<{ alert: string | null }>(
          `SELECT settle_ai_credit_gift($1::uuid, $2::numeric, $3::int, $4::int, $5::boolean, $6::uuid) AS alert`,
          [
            input.holdId,
            Math.max(0, input.costUsd).toFixed(6),
            Math.max(0, Math.floor(input.promptTokens)),
            Math.max(0, Math.floor(input.completionTokens)),
            input.released,
            input.keyId ?? null,
          ],
        );
        const alert = result.rows[0]?.alert;
        return alert === "80" || alert === "exhausted" ? alert : null;
      });
    },
    async noteKeyFailure(input) {
      await run(async (client) => {
        await client.query(`SELECT note_platform_key_failure($1::uuid, $2::uuid, $3::text)`, [
          input.giftId,
          input.keyId,
          input.reason.slice(0, 300),
        ]);
      });
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Email follow-up for the 80% and used-up alerts. The inbox notice is written by the database
// either way; email is sent only when the web app registered a mailer (and mail is configured).
// ---------------------------------------------------------------------------------------------

export type CreditGiftAlertMail = { orgId: string; userId: string; giftId: string; alert: GiftAlert };
type CreditGiftMailer = (mail: CreditGiftAlertMail) => Promise<void>;

const MAILER_KEY = Symbol.for("vantage.creditGiftAlertMailer");

/** Registered once per server process (apps/web instrumentation). */
export function setCreditGiftAlertMailer(mailer: CreditGiftMailer | null): void {
  (globalThis as Record<symbol, unknown>)[MAILER_KEY] = mailer ?? undefined;
}

/** Never throws: email is a courtesy on top of the inbox notice. */
export async function sendCreditGiftAlertEmail(mail: CreditGiftAlertMail): Promise<void> {
  const mailer = (globalThis as Record<symbol, unknown>)[MAILER_KEY] as CreditGiftMailer | undefined;
  if (!mailer) return;
  try {
    await mailer(mail);
  } catch {
    // Skipped quietly: the team still has the inbox notice.
  }
}

// ---------------------------------------------------------------------------------------------
// What a team sees.
// ---------------------------------------------------------------------------------------------

export type TeamCreditGift = {
  giftId: string;
  family: CreditGiftFamily;
  familyLabel: string;
  amountUsd: number;
  usedUsd: number;
  remainingUsd: number;
  expiresAt: string | null;
  grantedAt: string;
  note: string | null;
  active: boolean;
  usedUp: boolean;
};

export type TeamCreditGiftSummary = {
  gifts: TeamCreditGift[];
  totalUsd: number;
  usedUsd: number;
  remainingUsd: number;
  byModel: Array<{ model: string; label: string; usedUsd: number; calls: number }>;
};

function money(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : 0;
}

/** "Vantage gave your team $10 of AI credit · $3.20 used". */
export function teamCreditGiftLine(summary: Pick<TeamCreditGiftSummary, "totalUsd" | "usedUsd">): string {
  return `Vantage gave your team ${formatGiftUsd(summary.totalUsd)} of AI credit · ${formatGiftUsd(summary.usedUsd, true)} used`;
}

/** $10, $10.50, $3.20 — whole dollars without cents unless `cents`. */
export function formatGiftUsd(usd: number, cents = false): string {
  const value = Math.max(0, usd);
  if (!cents && Number.isInteger(Math.round(value * 100) / 100)) return `$${Math.round(value)}`;
  return `$${value.toFixed(2)}`;
}

export async function readTeamCreditGifts(client: PoolClient, orgId: string): Promise<TeamCreditGiftSummary> {
  const [gifts, models] = await Promise.all([
    client.query<{
      giftId: string;
      family: string;
      amountUsd: string;
      spentUsd: string;
      expiresAt: string | null;
      grantedAt: string;
      note: string | null;
      active: boolean;
    }>(
      `SELECT gift_id AS "giftId", family, amount_usd::text AS "amountUsd", spent_usd::text AS "spentUsd",
              expires_at::text AS "expiresAt", granted_at::text AS "grantedAt", note, active
         FROM ai_credit_gift_summary($1::uuid)`,
      [orgId],
    ),
    client.query<{ model: string | null; usedUsd: string; calls: string }>(
      `SELECT l.model, COALESCE(sum(l.cost_usd), 0)::text AS "usedUsd", count(*)::text AS calls
         FROM ai_credit_gift_ledger l
        WHERE l.org_id = $1::uuid AND l.state = 'settled'
        GROUP BY l.model
        ORDER BY 2 DESC`,
      [orgId],
    ),
  ]);
  const list: TeamCreditGift[] = gifts.rows
    .filter((row) => isCreditGiftFamily(row.family))
    .map((row) => {
      const amount = money(row.amountUsd);
      const used = Math.min(amount, money(row.spentUsd));
      const family = row.family as CreditGiftFamily;
      return {
        giftId: row.giftId,
        family,
        familyLabel: CREDIT_GIFT_FAMILIES[family].label,
        amountUsd: amount,
        usedUsd: used,
        remainingUsd: money(Math.max(0, amount - used)),
        expiresAt: row.expiresAt,
        grantedAt: row.grantedAt,
        note: row.note,
        active: row.active === true,
        usedUp: amount - used < CREDIT_GIFT_USED_UP_BELOW_USD,
      };
    });
  const live = list.filter((gift) => gift.active);
  const totalUsd = money(live.reduce((sum, gift) => sum + gift.amountUsd, 0));
  const usedUsd = money(live.reduce((sum, gift) => sum + gift.usedUsd, 0));
  return {
    gifts: list,
    totalUsd,
    usedUsd,
    remainingUsd: money(Math.max(0, totalUsd - usedUsd)),
    byModel: models.rows.map((row) => ({
      model: row.model ?? "unknown",
      label: creditGiftModelLabel(row.model ?? "unknown"),
      usedUsd: money(row.usedUsd),
      calls: Number(row.calls) || 0,
    })),
  };
}
