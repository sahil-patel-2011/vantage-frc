import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes
} from "node:crypto";
import {
  DecryptCommand,
  GenerateDataKeyCommand,
  KMSClient
} from "@aws-sdk/client-kms";
import type { PoolClient } from "@neondatabase/serverless";
import { CommitAndThrowError } from "@vantage/db";
import Stripe from "stripe";
import {
  emitAbsoluteSpendAlerts,
  enforceOrgAiGovernance,
} from "./ai-governance";

export { readOrgAllowance } from "./allowance";
export type { AllowanceFeatureSpend, OrgAllowance } from "./allowance";

export {
  ApprovalRequiredError,
  AiPolicyDeniedError,
  DEFAULT_ORG_AI_POLICY,
  FINANCE_IN_AI_ACK_VERSION,
  emitAbsoluteSpendAlerts,
  enforceOrgAiGovernance,
  isFeatureAllowed,
  isFinanceAiTool,
  isFinanceInAiAllowed,
  isToolAllowed,
  knownAiFeatures,
  knownAiTools,
  loadOrgAiPolicy,
  mapOrgAiPolicyRow,
  needsAiApproval,
  normalizeStringList,
  normalizeThresholds,
  parseOptionalUsd,
  type OrgAiPolicy,
} from "./ai-governance";
import {
  BYOK_LIST_MULTIPLIER,
  CATALOG_SERVICE_MULTIPLIER,
  LEGACY_PLAN_CODE_MAP,
  PRICING_CATALOG,
  TEAM_TRIAL_DAYS,
  byokEveryPlanCopy,
  canonicalPlanCode,
  catalogDefaultsFootnote,
  everyPlanValueLine,
  formatCatalogUsd,
  freeHostedModelClassCopy,
  hostedApiEconomicsSoftLine,
  hostedApiSavingsCopy,
  hostedCreditPackListApiUsd,
  hostedUsageDebitCopy,
  raisedPricingStrip,
  raisedPricingSummaryLine,
  teamCommitRangeCopy,
  type CatalogPlan,
  type CatalogPlanCode,
  type LegacyCatalogPlanCode,
} from "./catalog";

export {
  BYOK_LIST_MULTIPLIER,
  CATALOG_SERVICE_MULTIPLIER,
  LEGACY_PLAN_CODE_MAP,
  PRICING_CATALOG,
  TEAM_TRIAL_DAYS,
  byokEveryPlanCopy,
  canonicalPlanCode,
  catalogDefaultsFootnote,
  everyPlanValueLine,
  formatCatalogUsd,
  freeHostedModelClassCopy,
  hostedApiEconomicsSoftLine,
  hostedApiSavingsCopy,
  hostedCreditPackListApiUsd,
  hostedUsageDebitCopy,
  raisedPricingStrip,
  raisedPricingSummaryLine,
  teamCommitRangeCopy,
  type CatalogPlan,
  type CatalogPlanCode,
  type LegacyCatalogPlanCode,
};

export {
  UsageHardCutoffError,
  classifyMeteredAiError,
  cutoffMessage,
  meteredAiErrorBody,
  meteredAiErrorResponse,
  type ClassifiedMeteredAiError,
  type UsageCutoffCode as MeteredCutoffCode,
  type UsageCutoffCta,
  type UsageCutoffReason,
} from "./usage-cutoff";

export {
  SPONSORED_PROMO_ENDS_AT,
  SPONSORED_PROMO_EXPIRED_NOTIFICATION,
  SPONSORED_PROMO_TEAM_NUMBER,
  evaluateSponsoredPromoEligibility,
  hasAnySponsoredProviderEnvKey,
  isSponsoredPromoWindowOpen,
  loadOrgTeamNumber,
  maybeNotifySponsoredPromoExpired,
  resolveSponsoredPromoForOrg,
  sponsoredPromoEndsAtIso,
  sponsoredPromoExpiredMessage,
  type SponsoredPromoStatus,
} from "./sponsored-promo";

import {
  UsageHardCutoffError,
  classifyMeteredAiError,
  meteredAiErrorResponse,
} from "./usage-cutoff";
import {
  maybeNotifySponsoredPromoExpired,
  resolveSponsoredPromoForOrg,
  sponsoredPromoEndsAtIso,
} from "./sponsored-promo";

/** Stable machine codes for Soft-UI + API clients — never silent overage. */
export type UsageCutoffCode =
  | "credit_cap_exceeded"
  | "payg_not_enabled"
  | "insufficient_prepaid_balance"
  | "spend_cap"
  | "kill_switch"
  | "managed_allowance_exhausted"
  | "sponsored_allowance_exhausted";

export const USAGE_CUTOFF_MESSAGES: Record<UsageCutoffCode, string> = {
  credit_cap_exceeded:
    "This organization has reached its Vantage AI credit limit. Buy AI credits or enable PAYG with a spend cap — there is no silent overage.",
  payg_not_enabled:
    "Hosted AI usage is exhausted and pay-as-you-go is off. Buy AI credits or enable PAYG with a spend cap to continue.",
  insufficient_prepaid_balance:
    "Prepaid AI credits cannot cover this call. Buy a credit pack or raise the PAYG spend cap.",
  spend_cap:
    "PAYG overage is hard-stopped at the monthly spend cap. Raise the cap or buy AI credits.",
  kill_switch: "AI usage is currently disabled for this organization.",
  managed_allowance_exhausted:
    "Hosted AI usage is exhausted for this period. Buy AI credits or enable PAYG with a spend cap.",
  sponsored_allowance_exhausted:
    "Sponsored AI is exhausted. Use your own keys, local AI, buy AI credits, or upgrade.",
};

export class CreditCapExceededError extends Error {
  readonly code = "credit_cap_exceeded" as const;
  constructor(message = USAGE_CUTOFF_MESSAGES.credit_cap_exceeded) {
    super(message);
    this.name = "CreditCapExceededError";
  }
}

export class BillingDisabledError extends Error {
  readonly code = "kill_switch" as const;
  constructor(message = USAGE_CUTOFF_MESSAGES.kill_switch) {
    super(message);
    this.name = "BillingDisabledError";
  }
}

export class DuplicateMeteredRequestError extends Error {
  readonly code = "duplicate_metered_request" as const;
  constructor(readonly requestId: string) {
    super(`Metered request ${requestId} has already completed or is still in progress`);
    this.name = "DuplicateMeteredRequestError";
  }
}

/** Map meteredAI / budget errors to HTTP 402 bodies with stable `code` fields. */
export function describeBillingError(error: unknown): {
  code: string;
  message: string;
  status: 402 | 403 | 429;
  reason?: string;
} | null {
  const classified = classifyMeteredAiError(error);
  if (classified) {
    return {
      code: classified.code,
      message: classified.message,
      status: classified.status,
      reason: classified.reason,
    };
  }
  if (error instanceof BudgetLimitExceededError) {
    return { code: error.reason, message: error.message, status: 402, reason: error.reason };
  }
  return null;
}

export function billingErrorResponse(error: unknown): Response | null {
  return meteredAiErrorResponse(error) ?? (() => {
    const described = describeBillingError(error);
    if (!described) return null;
    return Response.json(
      { error: described.message, code: described.code, reason: described.reason, hardStop: true },
      { status: described.status },
    );
  })();
}

export type UsageReceipt<T> = {
  value: T;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  model: string;
  provider: string;
  keySource?: MeterKeySource;
  cacheReadInputTokens?: number;
  cacheWriteInputTokens?: number;
  uncachedInputTokens?: number;
};

/**
 * Platform-billed, org BYOK, OpenAI-compatible local gateway, local CLI, or
 * platform-sponsored promo pool (`sponsored` — $0 Vantage charge).
 */
export type MeterKeySource =
  | "platform"
  | "byo"
  | "local"
  | "local_cli"
  | "sponsored"
  /** A paired member's Claude/ChatGPT subscription served the turn (AI bridge, 0486). */
  | "subscription_bridge";

export type MeteredAIInput<T> = {
  client: PoolClient;
  orgId: string;
  userId: string;
  feature: string;
  requestId: string;
  estimatedCostUsd: number;
  estimatedPromptTokens?: number;
  estimatedCompletionTokens?: number;
  provider?: string;
  model?: string;
  metadata?: Record<string, unknown>;
  billingOwner?: { type: "user" | "org"; id: string };
  /**
   * When `local_cli`, Vantage never charges and ledger cost is forced to 0.
   * When `byo` / `local`, skip hosted credit caps (caller already resolved org keys).
   * When `sponsored`, platform promo pool — ledger cost 0, no credit debit.
   * When omitted, prefer configured org BYOK/local over hosted platform for any tier.
   * When `platform`, skip BYOK detection — used by flat-fee hosted SKUs (Bugbot Ultra).
   */
  keySource?: MeterKeySource;
  invoke: (keySource: MeterKeySource) => Promise<UsageReceipt<T>>;
};

function isLoopbackProviderUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return /localhost|127\.0\.0\.1|\[::1\]/i.test(value);
  }
}

/**
 * Prefer org BYOK / OpenAI-compatible connectors over hosted platform metering.
 * Returns null when the org has no usable bring-your-own path.
 */
export async function detectOrgByokKeySource(
  client: PoolClient,
  orgId: string,
): Promise<"byo" | "local" | null> {
  const providers = await client.query<{
    kind: string;
    baseUrl: string | null;
    localRelay: boolean;
  }>(
    `SELECT kind, base_url AS "baseUrl", local_relay AS "localRelay"
       FROM org_provider_configs
      WHERE org_id = $1::uuid
        AND enabled = true
        AND disabled_at IS NULL
      ORDER BY created_at DESC`,
    [orgId],
  );
  for (const row of providers.rows) {
    const kind = row.kind.trim().toLowerCase();
    if (row.localRelay) return "local";
    if (
      kind === "local" ||
      kind === "ollama" ||
      kind === "lm-studio" ||
      kind === "lmstudio"
    ) {
      return "local";
    }
    if (kind === "openai-compatible" || row.baseUrl) {
      if (isLoopbackProviderUrl(row.baseUrl)) return "local";
      return "byo";
    }
  }
  const keys = await client.query(
    `SELECT 1 FROM org_llm_keys WHERE org_id = $1::uuid LIMIT 1`,
    [orgId],
  );
  if (keys.rows.length > 0) return "byo";
  return null;
}

function isExternalKeySource(source: MeterKeySource): boolean {
  return (
    source === "byo" ||
    source === "local" ||
    source === "local_cli" ||
    source === "sponsored" ||
    source === "subscription_bridge"
  );
}
const ORG_BILLING_LOCK_NAMESPACE = "vantage:org_billing:";
const UNSIGNED_64_SPAN = 1n << 64n;
const SIGNED_64_MAX = (1n << 63n) - 1n;

/**
 * Stable advisory-lock key for one org's billing cap check.
 * `pg_advisory_*` takes a SIGNED 64-bit bigint, so the namespaced digest is folded
 * with BigInt arithmetic — Number loses precision above 2^53 and would collide.
 * Returned as a decimal string so it can be passed straight to a `$1::bigint` param.
 */
export function orgBillingLockKey(orgId: string): string {
  const digest = createHash("sha256").update(`${ORG_BILLING_LOCK_NAMESPACE}${orgId}`).digest();
  let value = 0n;
  for (let index = 0; index < 8; index += 1) value = (value << 8n) | BigInt(digest[index]!);
  return (value > SIGNED_64_MAX ? value - UNSIGNED_64_SPAN : value).toString();
}

type LockedCreditWallet={accountId:string;included:number;purchased:number;gifted:number;serviceMultiplier:number;entitlementSnapshot:Record<string,unknown>;planCode:string};
/**
 * `lockRow` takes `FOR UPDATE OF w`, and is ONLY ever true at settle time — after the
 * provider call has returned. A row lock is held until the caller's transaction
 * commits, so taking one before `invoke()` would pin the wallet row for the whole
 * request and stall every other metered call for that billing owner: exactly the
 * org-wide stall this restructure exists to remove, just moved off `org_billing`.
 * Balances are clamped to >= 0 so an overshoot from an unserialized concurrent debit
 * can never allocate from a negative balance.
 */
async function readCreditWallet<T>(input:MeteredAIInput<T>,lockRow:boolean):Promise<{wallet:LockedCreditWallet;featureFlags:Record<string,boolean>}|null>{
  if(!input.billingOwner)return null;const owner=input.billingOwner;
  const result=await input.client.query<{accountId:string;included:string;purchased:string;gifted:string;serviceMultiplier:string;termsSnapshot:Record<string,unknown>;planCode:string}>(`SELECT a.id AS "accountId",w.included_balance AS included,w.purchased_balance AS purchased,w.gifted_balance AS gifted,
    v.service_multiplier AS "serviceMultiplier",s.terms_snapshot AS "termsSnapshot",s.plan_code AS "planCode"
    FROM billing_accounts a JOIN billing_subscriptions s ON s.billing_account_id=a.id AND s.status IN ('active','trialing')
    JOIN plan_entitlement_versions v ON v.id=s.entitlement_version_id JOIN credit_wallets w ON w.billing_account_id=a.id
    WHERE (($1='user' AND a.owner_user_id=$2) OR ($1='org' AND a.owner_org_id=$2))
      AND s.current_period_start<=now() AND s.current_period_end>now()${lockRow?" FOR UPDATE OF w":""}`,[owner.type,owner.id]);
  const row=result.rows[0];if(!row)return null;
  const featureFlags=(row.termsSnapshot.featureFlags??{}) as Record<string,boolean>;
  const wallet={accountId:row.accountId,included:Math.max(0,Number(row.included)),purchased:Math.max(0,Number(row.purchased)),gifted:Math.max(0,Number(row.gifted)),serviceMultiplier:Number(row.serviceMultiplier),entitlementSnapshot:row.termsSnapshot,planCode:row.planCode};
  return{wallet,featureFlags};
}
/** Pre-call entitlement + cap check. Reads UNLOCKED: see readCreditWallet on why. */
async function checkCreditWallet<T>(input:MeteredAIInput<T>,keySource:MeterKeySource):Promise<LockedCreditWallet|null>{
  if(isExternalKeySource(keySource))return null;
  const read=await readCreditWallet(input,false);if(!read)return null;
  if(read.featureFlags[input.feature]===false)throw new Error("This feature is not included in the billing owner's entitlement snapshot");
  const wallet=read.wallet;
  if(keySource==="platform"&&input.estimatedCostUsd*wallet.serviceMultiplier>wallet.included+wallet.purchased+wallet.gifted)throw new CreditCapExceededError();return wallet;
}
export function allocateCreditDebit(input:{included:number;purchased:number;gifted:number;providerCostUsd:number;serviceMultiplier:number}){let remaining=input.providerCostUsd*input.serviceMultiplier;const fromIncluded=Math.min(input.included,remaining);remaining-=fromIncluded;const fromPurchased=Math.min(input.purchased,remaining);remaining-=fromPurchased;const fromGifted=Math.min(input.gifted,remaining);remaining-=fromGifted;if(remaining>1e-9)throw new CreditCapExceededError();return{debit:input.providerCostUsd*input.serviceMultiplier,fromIncluded,fromPurchased,fromGifted,bucket:fromIncluded>0&&fromPurchased+fromGifted===0?"included":fromPurchased>0&&fromIncluded+fromGifted===0?"purchased":fromGifted>0&&fromIncluded+fromPurchased===0?"gifted":"mixed"};}
/**
 * Settle-time sibling of allocateCreditDebit for a call the provider has ALREADY
 * billed. It never throws: it debits what the wallet actually holds and reports the
 * uncovered remainder as `shortfallUsd`, which the usage event records instead of
 * dropping the call. Pre-call denial is the inline cap check in checkCreditWallet;
 * allocateCreditDebit below is retained for callers outside this module.
 */
export function settleCreditDebit(input:{included:number;purchased:number;gifted:number;providerCostUsd:number;serviceMultiplier:number}){
  const owed=input.providerCostUsd*input.serviceMultiplier;let remaining=owed;
  const fromIncluded=Math.min(Math.max(0,input.included),remaining);remaining-=fromIncluded;
  const fromPurchased=Math.min(Math.max(0,input.purchased),remaining);remaining-=fromPurchased;
  const fromGifted=Math.min(Math.max(0,input.gifted),remaining);remaining-=fromGifted;
  const shortfallUsd=remaining>1e-9?remaining:0;
  return{debit:owed-shortfallUsd,owedUsd:owed,shortfallUsd,fromIncluded,fromPurchased,fromGifted,bucket:fromIncluded>0&&fromPurchased+fromGifted===0?"included":fromPurchased>0&&fromIncluded+fromGifted===0?"purchased":fromGifted>0&&fromIncluded+fromPurchased===0?"gifted":"mixed"};
}

const numberOrNull = (value: unknown) =>
  value === null || value === undefined ? null : Number(value);

async function enforceApiBudgets<T>(
  input: MeteredAIInput<T>,
  tier: string,
  keySource: MeterKeySource,
) {
  const [policyResult, memberResult, featureResult, modelResult, usageResult, safetyResult] =
    await Promise.all([
      input.client.query(
        `SELECT daily_spend_limit_usd,monthly_spend_limit_usd,daily_token_limit,monthly_token_limit,
          enforce_byo_token_limits,model_allowlist_enabled,provider_allowlist_enabled,kill_switch
         FROM org_api_budget_policies WHERE org_id=$1`,
        [input.orgId],
      ),
      input.client.query(
        `SELECT daily_spend_limit_usd,monthly_spend_limit_usd,daily_token_limit,monthly_token_limit
         FROM org_api_member_limits WHERE org_id=$1 AND user_id=$2`,
        [input.orgId, input.userId],
      ),
      input.client.query(
        `SELECT daily_spend_limit_usd,monthly_spend_limit_usd,daily_token_limit,monthly_token_limit
         FROM org_api_feature_limits WHERE org_id=$1 AND feature=$2`,
        [input.orgId, input.feature],
      ),
      input.client.query(
        `SELECT allowed,daily_spend_limit_usd,monthly_spend_limit_usd,daily_token_limit,monthly_token_limit
         FROM org_api_model_limits WHERE org_id=$1 AND provider=$2 AND model IN ($3,'*')
         ORDER BY CASE WHEN model=$3 THEN 0 ELSE 1 END LIMIT 1`,
        [input.orgId, input.provider ?? "", input.model ?? ""],
      ),
      input.client.query(
        `SELECT
          COALESCE(sum(cost_usd) FILTER(WHERE created_at>=date_trunc('day',now())),0)::text AS org_day_cost,
          COALESCE(sum(cost_usd),0)::text AS org_month_cost,
          COALESCE(sum(total_tokens) FILTER(WHERE created_at>=date_trunc('day',now())),0)::text AS org_day_tokens,
          COALESCE(sum(total_tokens),0)::text AS org_month_tokens,
          COALESCE(sum(cost_usd) FILTER(WHERE user_id=$2 AND created_at>=date_trunc('day',now())),0)::text AS member_day_cost,
          COALESCE(sum(cost_usd) FILTER(WHERE user_id=$2),0)::text AS member_month_cost,
          COALESCE(sum(total_tokens) FILTER(WHERE user_id=$2 AND created_at>=date_trunc('day',now())),0)::text AS member_day_tokens,
          COALESCE(sum(total_tokens) FILTER(WHERE user_id=$2),0)::text AS member_month_tokens,
          COALESCE(sum(cost_usd) FILTER(WHERE feature=$3 AND created_at>=date_trunc('day',now())),0)::text AS feature_day_cost,
          COALESCE(sum(cost_usd) FILTER(WHERE feature=$3),0)::text AS feature_month_cost,
          COALESCE(sum(total_tokens) FILTER(WHERE feature=$3 AND created_at>=date_trunc('day',now())),0)::text AS feature_day_tokens,
          COALESCE(sum(total_tokens) FILTER(WHERE feature=$3),0)::text AS feature_month_tokens,
          COALESCE(sum(cost_usd) FILTER(WHERE provider=$4 AND model=$5 AND created_at>=date_trunc('day',now())),0)::text AS model_day_cost,
          COALESCE(sum(cost_usd) FILTER(WHERE provider=$4 AND model=$5),0)::text AS model_month_cost,
          COALESCE(sum(total_tokens) FILTER(WHERE provider=$4 AND model=$5 AND created_at>=date_trunc('day',now())),0)::text AS model_day_tokens,
          COALESCE(sum(total_tokens) FILTER(WHERE provider=$4 AND model=$5),0)::text AS model_month_tokens
         FROM ai_usage_events WHERE org_id=$1 AND created_at>=date_trunc('month',now())`,
        [input.orgId, input.userId, input.feature, input.provider ?? "", input.model ?? ""],
      ),
      input.client.query(
        `SELECT max_daily_spend_usd AS daily_spend_limit_usd,
          max_monthly_spend_usd AS monthly_spend_limit_usd,max_daily_tokens AS daily_token_limit,
          max_monthly_tokens AS monthly_token_limit FROM platform_api_safety_caps WHERE tier=$1`,
        [tier],
      ),
    ]);
  const policy = policyResult.rows[0] as Record<string, unknown> | undefined;
  const member = memberResult.rows[0] as Record<string, unknown> | undefined;
  const feature = featureResult.rows[0] as Record<string, unknown> | undefined;
  const model = modelResult.rows[0] as Record<string, unknown> | undefined;
  const usage = (usageResult.rows[0] ?? {}) as Record<string, unknown>;
  const safety = safetyResult.rows[0] as Record<string, unknown> | undefined;
  const estimatedTokens =
    isExternalKeySource(keySource) &&
    keySource !== "local_cli" &&
    policy?.enforce_byo_token_limits === false
      ? 0
      : (input.estimatedPromptTokens ?? 0) + (input.estimatedCompletionTokens ?? 0);
  const deny = async (reason: string) => {
    await input.client.query(
      `INSERT INTO api_usage_denials(org_id,user_id,feature,provider,model,estimated_cost_usd,
        estimated_tokens,reason,request_id,metadata)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
       ON CONFLICT(request_id) DO NOTHING`,
      [
        input.orgId, input.userId, input.feature, input.provider ?? null, input.model ?? null,
        input.estimatedCostUsd, estimatedTokens, reason, input.requestId,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    throw new CommitAndThrowError(new BudgetLimitExceededError(reason));
  };
  if (policy?.kill_switch === true) await deny("org.kill_switch");
  if (
    (policy?.model_allowlist_enabled === true || policy?.provider_allowlist_enabled === true) &&
    (!input.provider || !input.model || !model)
  )
    await deny("model.not_allowed");
  if (model?.allowed === false) await deny("model.not_allowed");
  const createLayer = (
    name: string,
    limit: Record<string, unknown> | undefined,
    prefix: string,
  ): LayeredBudget | null =>
    limit
      ? {
          name,
          dailySpendLimit: numberOrNull(limit.daily_spend_limit_usd),
          monthlySpendLimit: numberOrNull(limit.monthly_spend_limit_usd),
          dailyTokenLimit: numberOrNull(limit.daily_token_limit),
          monthlyTokenLimit: numberOrNull(limit.monthly_token_limit),
          dailySpendUsed: Number(usage[`${prefix}_day_cost`] ?? 0),
          monthlySpendUsed: Number(usage[`${prefix}_month_cost`] ?? 0),
          dailyTokensUsed: Number(usage[`${prefix}_day_tokens`] ?? 0),
          monthlyTokensUsed: Number(usage[`${prefix}_month_tokens`] ?? 0),
        }
      : null;
  const layers = [
    createLayer("platform", safety, "org"),
    createLayer("org", policy, "org"),
    createLayer("member", member, "member"),
    createLayer("feature", feature, "feature"),
    createLayer("model", model, "model"),
  ].filter((value): value is LayeredBudget => value !== null);
  const violation = findBudgetViolation(layers, input.estimatedCostUsd, estimatedTokens);
  if (violation) await deny(violation);
}

export class BudgetLimitExceededError extends Error {
  readonly code: string;
  constructor(readonly reason: string) {
    super(`API budget limit reached (${reason}).`);
    this.name = "BudgetLimitExceededError";
    this.code = reason;
  }
}

async function emitBudgetWarnings(client: PoolClient, orgId: string) {
  const result = await client.query<{
    warningThresholds: number[];
    dailySpendLimit: string | null;
    monthlySpendLimit: string | null;
    dailyTokenLimit: number | null;
    monthlyTokenLimit: number | null;
    dailySpend: string;
    monthlySpend: string;
    dailyTokens: string;
    monthlyTokens: string;
  }>(
    `SELECT p.warning_thresholds AS "warningThresholds",
      p.daily_spend_limit_usd AS "dailySpendLimit",p.monthly_spend_limit_usd AS "monthlySpendLimit",
      p.daily_token_limit AS "dailyTokenLimit",p.monthly_token_limit AS "monthlyTokenLimit",
      COALESCE(sum(a.cost_usd) FILTER(WHERE a.created_at>=date_trunc('day',now())),0)::text AS "dailySpend",
      COALESCE(sum(a.cost_usd),0)::text AS "monthlySpend",
      COALESCE(sum(a.total_tokens) FILTER(WHERE a.created_at>=date_trunc('day',now())),0)::text AS "dailyTokens",
      COALESCE(sum(a.total_tokens),0)::text AS "monthlyTokens"
     FROM org_api_budget_policies p LEFT JOIN ai_usage_events a
       ON a.org_id=p.org_id AND a.created_at>=date_trunc('month',now())
     WHERE p.org_id=$1 GROUP BY p.org_id`,
    [orgId],
  );
  const row = result.rows[0];
  if (!row) return;
  const ratios = [
    row.dailySpendLimit ? Number(row.dailySpend) / Number(row.dailySpendLimit) : 0,
    row.monthlySpendLimit ? Number(row.monthlySpend) / Number(row.monthlySpendLimit) : 0,
    row.dailyTokenLimit ? Number(row.dailyTokens) / row.dailyTokenLimit : 0,
    row.monthlyTokenLimit ? Number(row.monthlyTokens) / row.monthlyTokenLimit : 0,
  ];
  const percent = Math.floor(Math.max(...ratios) * 100);
  const threshold = [...(Array.isArray(row.warningThresholds) ? row.warningThresholds : [50, 75, 90])].sort((a, b) => b - a).find((value) => percent >= value);
  if (!threshold) return;
  const elapsedDays = Math.max(1, new Date().getUTCDate());
  const dailyRate = Number(row.monthlySpend) / elapsedDays;
  const projectedExhaustionDays =
    row.monthlySpendLimit && dailyRate > 0
      ? Math.max(0, (Number(row.monthlySpendLimit) - Number(row.monthlySpend)) / dailyRate)
      : null;
  await client.query(
    `INSERT INTO notifications(user_id,org_id,type,payload)
     SELECT m.user_id,$1,$2,$3::jsonb FROM memberships m
     WHERE m.org_id=$1 AND m.role IN ('owner','admin') AND NOT EXISTS(
       SELECT 1 FROM notifications n WHERE n.user_id=m.user_id AND n.org_id=$1
        AND n.type=$2 AND n.created_at>=date_trunc('day',now())
     )`,
    [
      orgId,
      `api_budget.warning.${threshold}`,
      JSON.stringify({
        threshold,
        currentPercent: percent,
        projectedExhaustionDays,
        delivery: ["in_app", "email"],
      }),
    ],
  );
}

export type LayeredBudget = {
  name: string;
  dailySpendLimit: number | null;
  monthlySpendLimit: number | null;
  dailyTokenLimit: number | null;
  monthlyTokenLimit: number | null;
  dailySpendUsed: number;
  monthlySpendUsed: number;
  dailyTokensUsed: number;
  monthlyTokensUsed: number;
};

export function findBudgetViolation(
  budgets: LayeredBudget[],
  estimatedCostUsd: number,
  estimatedTokens: number,
) {
  for (const budget of budgets) {
    if (budget.dailySpendLimit !== null && budget.dailySpendUsed + estimatedCostUsd > budget.dailySpendLimit)
      return `${budget.name}.daily_spend`;
    if (budget.monthlySpendLimit !== null && budget.monthlySpendUsed + estimatedCostUsd > budget.monthlySpendLimit)
      return `${budget.name}.monthly_spend`;
    if (budget.dailyTokenLimit !== null && budget.dailyTokensUsed + estimatedTokens > budget.dailyTokenLimit)
      return `${budget.name}.daily_tokens`;
    if (budget.monthlyTokenLimit !== null && budget.monthlyTokensUsed + estimatedTokens > budget.monthlyTokenLimit)
      return `${budget.name}.monthly_tokens`;
  }
  return null;
}

/**
 * Must be called inside the same transaction established by withRls().
 *
 * A transaction-scoped advisory lock on the org serializes the cap check in the
 * common case. When another call for the same org already holds it we deliberately
 * DO NOT block: the provider call runs inside this transaction, so waiting meant one
 * long request (a season report can hold the AI bridge for minutes) froze every other
 * metered call for that org. The unserialized call instead runs its cap check against
 * committed usage only and records `meteringSerialized: false`. Overshoot is bounded:
 * each concurrent caller can exceed the cap by at most its own estimated cost, so the
 * worst case for a window is the sum of the in-flight estimates — never unbounded.
 *
 * On an autocommit connection (worker paths that wrap this in their own BEGIN/COMMIT —
 * see apps/web/lib/parent-comms/send-digest.ts `transactionalAi`) a transaction-scoped
 * advisory lock releases at statement end, exactly as the old row lock did: unchanged.
 *
 * `keySource: "local_cli"` skips credit caps and always records cost_usd = 0.
 * When an org has BYOK / OpenAI-compatible keys configured, prefer that path and
 * do not consume hosted Usage Credits — even on paid tiers (0.75× hosted still
 * applies when no BYOK is present).
 */
export async function meteredAI<T>(input: MeteredAIInput<T>): Promise<T> {
  if (input.estimatedCostUsd < 0) throw new Error("Estimated cost cannot be negative");

  // One request id may reach this service only once, including concurrent retries.
  // The request-scoped lock is separate from the non-blocking org budget lock below:
  // duplicates wait for the first transaction, then observe its committed usage row.
  await input.client.query(`SELECT pg_advisory_xact_lock($1::bigint)`, [
    orgBillingLockKey(`metered-request:${input.requestId}`),
  ]);
  const priorUsage = await input.client.query<{ id: string }>(
    `SELECT id FROM ai_usage_events WHERE request_id=$1 LIMIT 1`,
    [input.requestId],
  );
  if (priorUsage.rows[0]) throw new DuplicateMeteredRequestError(input.requestId);

  if (input.keySource === "local_cli") {
    const receipt = await input.invoke("local_cli");
    await input.client.query(
      `INSERT INTO ai_usage_events
        (org_id, user_id, feature, model, provider, key_source, prompt_tokens,
         completion_tokens, total_tokens, cost_usd, request_id, metadata,
         cache_read_input_tokens, cache_write_input_tokens, uncached_input_tokens)
       VALUES ($1,$2,$3,$4,$5,'local_cli',$6,$7,$8,0,$9,$10::jsonb,$11,$12,$13)`,
      [
        input.orgId,
        input.userId,
        input.feature,
        receipt.model,
        receipt.provider,
        receipt.promptTokens,
        receipt.completionTokens,
        receipt.promptTokens + receipt.completionTokens,
        input.requestId,
        JSON.stringify({ ...(input.metadata ?? {}), vantageChargeUsd: 0, path: "local_cli" }),
        receipt.cacheReadInputTokens ?? 0,
        receipt.cacheWriteInputTokens ?? 0,
        receipt.uncachedInputTokens ?? receipt.promptTokens,
      ],
    );
    return receipt.value;
  }

  const lock = await input.client.query<{ locked: boolean }>(
    `SELECT pg_try_advisory_xact_lock($1::bigint) AS locked`,
    [orgBillingLockKey(input.orgId)],
  );
  const serialized = lock.rows[0]?.locked === true;

  const billing = await input.client.query<{
    tier: "free" | "starter" | "team" | "enterprise";
    credit_cap_usd: string;
    kill_switch: boolean;
    period_start: Date;
    period_end: Date;
  }>(
    `SELECT tier, credit_cap_usd, kill_switch, period_start, period_end
       FROM org_billing WHERE org_id = $1`,
    [input.orgId]
  );
  const account = billing.rows[0];
  if (!account) throw new Error("Billing account is not configured");
  if (account.kill_switch) throw new BillingDisabledError();

  let keySource: MeterKeySource;
  if (input.keySource === "platform") {
    keySource = "platform";
  } else if (input.keySource === "byo" || input.keySource === "local" || input.keySource === "sponsored") {
    keySource = input.keySource;
  } else if (input.provider === "subscription-bridge") {
    // The resolved adapter is a paired member's subscription (AI bridge). External
    // path: the subscription pays, no credit caps, and — crucially — an org whose ONLY
    // AI is a bridge must not be told to configure a BYO key. Cost stays honest: the
    // bridge reports $0; when the adapter internally fell back to a real key, settle
    // time reclassifies from the truthful receipt.provider so the bill is enforced.
    keySource = "subscription_bridge";
  } else {
    const detected = await detectOrgByokKeySource(input.client, input.orgId);
    if (detected) {
      keySource = detected;
    } else if (account.tier === "free") {
      const promo = await resolveSponsoredPromoForOrg(input.client, input.orgId);
      if (promo.eligible) {
        keySource = "sponsored";
      } else if (promo.reason === "promo_expired") {
        await maybeNotifySponsoredPromoExpired(input.client, input.orgId, promo);
        throw new CommitAndThrowError(
          new UsageHardCutoffError("sponsored_promo_expired"),
        );
      } else {
        throw new Error("Free organizations must configure a BYO AI key");
      }
    } else {
      keySource = "platform";
    }
  }
  if (keySource === "byo" || keySource === "local") {
    const key = await input.client.query(
      `SELECT 1 FROM org_llm_keys WHERE org_id = $1
       UNION ALL
       SELECT 1 FROM org_provider_configs
       WHERE org_id = $1 AND enabled = true AND disabled_at IS NULL
       LIMIT 1`,
      [input.orgId],
    );
    if (!key.rows.length) throw new Error("Free organizations must configure a BYO AI key");
  }
  if (keySource === "sponsored") {
    const promo = await resolveSponsoredPromoForOrg(input.client, input.orgId);
    if (!promo.eligible) {
      if (promo.reason === "promo_expired") {
        await maybeNotifySponsoredPromoExpired(input.client, input.orgId, promo);
        throw new CommitAndThrowError(new UsageHardCutoffError("sponsored_promo_expired"));
      }
      throw new Error(promo.message || "Sponsored AI is not available for this organization");
    }
  }
  const creditWallet = await checkCreditWallet(input, keySource);
  await enforceApiBudgets(input, account.tier, keySource);
  await enforceOrgAiGovernance({
    client: input.client,
    orgId: input.orgId,
    userId: input.userId,
    feature: input.feature,
    requestId: input.requestId,
    estimatedCostUsd: input.estimatedCostUsd,
    provider: input.provider,
    model: input.model,
    metadata: input.metadata,
  });
  if (keySource === "platform") {
    const totals = await input.client.query<{ used: string; grants: string }>(
      `SELECT
         COALESCE((SELECT SUM(cost_usd) FROM ai_usage_events
           WHERE org_id = $1 AND created_at >= $2 AND created_at < $3), 0)::text AS used,
         COALESCE((SELECT SUM(amount_usd) FROM ai_credit_grants WHERE org_id = $1), 0)::text AS grants`,
      [input.orgId, account.period_start, account.period_end]
    );
    const used = Number(totals.rows[0]?.used ?? 0);
    const grants = Number(totals.rows[0]?.grants ?? 0);
    // Included allowance is the period credit cap only — grants/credits are prepaid, not silent overage.
    const includedCap = Number(account.credit_cap_usd);
    let includedRemainingUsd = Math.max(0, includedCap - used);
    const overageUsedUsd = Math.max(0, used - includedCap);

    const policy = await input.client.query<{
      payg_enabled: boolean;
      prepaid_balance_usd: string;
      overage_spend_cap_usd: string;
      kill_switch: boolean;
    }>(
      `SELECT payg_enabled, prepaid_balance_usd, overage_spend_cap_usd, kill_switch
         FROM org_usage_policies WHERE org_id = $1`,
      [input.orgId],
    );
    const usagePolicy = policy.rows[0];
    const paygOnly =
      typeof input.metadata?.paygOnly === "boolean" ? input.metadata.paygOnly : false;
    const walletPrepaid = creditWallet
      ? creditWallet.purchased + creditWallet.gifted
      : 0;
    if (creditWallet) {
      includedRemainingUsd = Math.max(includedRemainingUsd, creditWallet.included);
    }
    const decision = evaluateManagedUsage({
      includedRemainingUsd,
      estimatedCostUsd: input.estimatedCostUsd * (creditWallet?.serviceMultiplier ?? 1),
      paygOnly,
      paygEnabled: usagePolicy?.payg_enabled === true,
      prepaidBalanceUsd: Number(usagePolicy?.prepaid_balance_usd ?? 0) + grants + walletPrepaid,
      overageUsedUsd,
      overageSpendCapUsd: Number(usagePolicy?.overage_spend_cap_usd ?? 0),
      killSwitch: account.kill_switch || usagePolicy?.kill_switch === true,
    });
    if (!decision.allowed) {
      const reason = decision.reason ?? "payg_not_enabled";
      await input.client.query(
        `INSERT INTO api_usage_denials(org_id,user_id,feature,provider,model,estimated_cost_usd,
          estimated_tokens,reason,request_id,metadata)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
         ON CONFLICT(request_id) DO NOTHING`,
        [
          input.orgId,
          input.userId,
          input.feature,
          input.provider ?? null,
          input.model ?? null,
          input.estimatedCostUsd,
          (input.estimatedPromptTokens ?? 0) + (input.estimatedCompletionTokens ?? 0),
          reason,
          input.requestId,
          JSON.stringify({ ...(input.metadata ?? {}), hardCutoff: true, bucket: decision.bucket }),
        ],
      );
      throw new CommitAndThrowError(new UsageHardCutoffError(reason));
    }
  }

  const receipt = await input.invoke(keySource);
  if (receipt.costUsd < 0) throw new Error("Provider returned a negative cost");
  // The bridge adapter falls through to the resolved key chain whenever the paired
  // subscription cannot serve the turn, and receipt.provider names who actually did.
  // A fallback onto a hosted Vantage key must settle as platform — otherwise a real
  // provider bill is recorded as an external $0 source and escapes credit enforcement.
  let settledKeySource = keySource;
  if (keySource === "subscription_bridge" && receipt.provider !== "subscription-bridge") {
    settledKeySource = (await detectOrgByokKeySource(input.client, input.orgId)) ?? "platform";
  }
  // Re-read the wallet UNDER `FOR UPDATE` here and only here. The pre-call read was
  // unlocked (it could not hold a lock across invoke), so these are the first balances
  // that are safe to debit from, and the lock lasts only the few statements left before
  // commit. `creditWallet` above is a cap-check snapshot, never a debit basis.
  const settledWallet =
    settledKeySource === "platform" ? ((await readCreditWallet(input, true))?.wallet ?? null) : null;
  // A call the provider already billed is ALWAYS recorded. Settle-time allocation
  // clamps to what the wallet holds and surfaces any uncovered remainder as
  // creditShortfallUsd; throwing here would roll back the usage event for a call
  // that really happened and hand the org unrecorded, replayable AI.
  const settlement =
    settledWallet && settledKeySource === "platform"
      ? settleCreditDebit({ ...settledWallet, providerCostUsd: receipt.costUsd })
      : null;
  const ledgerCostUsd =
    settledKeySource === "local" || settledKeySource === "sponsored" ? 0 : receipt.costUsd;
  await input.client.query(
    `INSERT INTO ai_usage_events
      (org_id, user_id, feature, model, provider, key_source, prompt_tokens,
       completion_tokens, total_tokens, cost_usd, request_id, metadata,
       cache_read_input_tokens, cache_write_input_tokens, uncached_input_tokens)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15)`,
    [
      input.orgId,
      input.userId,
      input.feature,
      receipt.model,
      receipt.provider,
      settledKeySource,
      receipt.promptTokens,
      receipt.completionTokens,
      receipt.promptTokens + receipt.completionTokens,
      ledgerCostUsd,
      input.requestId,
      JSON.stringify({
        ...(input.metadata ?? {}),
        ...(serialized ? {} : { meteringSerialized: false }),
        ...(settledKeySource === keySource ? {} : { settledFrom: keySource }),
        ...(settlement && settlement.shortfallUsd > 0
          ? { creditShortfallUsd: settlement.shortfallUsd }
          : {}),
        ...(isExternalKeySource(settledKeySource)
          ? {
              vantageChargeUsd: 0,
              path: settledKeySource,
              ...(settledKeySource === "sponsored"
                ? {
                    fundingMode: "sponsored",
                    providerCostUsd: receipt.costUsd,
                    promoEndsAt: sponsoredPromoEndsAtIso(),
                  }
                : {}),
            }
          : {}),
      }),
      receipt.cacheReadInputTokens ?? 0,
      receipt.cacheWriteInputTokens ?? 0,
      receipt.uncachedInputTokens ?? receipt.promptTokens,
    ]
  );
  if(settledWallet&&settlement){
    await input.client.query(`UPDATE credit_wallets SET included_balance=included_balance-$2,purchased_balance=purchased_balance-$3,gifted_balance=gifted_balance-$4,updated_at=now() WHERE billing_account_id=$1`,[settledWallet.accountId,settlement.fromIncluded,settlement.fromPurchased,settlement.fromGifted]);
    await input.client.query(`INSERT INTO credit_ledger(billing_account_id,kind,credits,provider_cost_usd,service_multiplier,bucket,reference_id,metadata) VALUES($1,'ai_debit',$2,$3,$4,$5,$6,$7::jsonb)`,[settledWallet.accountId,-settlement.debit,receipt.costUsd,settledWallet.serviceMultiplier,settlement.bucket,input.requestId,JSON.stringify({orgId:input.orgId,userId:input.userId,feature:input.feature,planCode:settledWallet.planCode,...(settlement.shortfallUsd>0?{creditShortfallUsd:settlement.shortfallUsd}:{})})]);
  }
  if (settledKeySource === "platform") {
    await input.client.query(
      `UPDATE org_plan_periods SET provider_cost_used_usd=provider_cost_used_usd+$2
       WHERE org_id=$1 AND status='active' AND period_start<=now() AND period_end>now()`,
      [input.orgId, receipt.costUsd],
    );
  }
  await emitBudgetWarnings(input.client, input.orgId);
  await emitAbsoluteSpendAlerts(input.client, input.orgId);
  return receipt.value;
}

export interface KeyManagementService {
  readonly keyId: string;
  generateDataKey(): Promise<{ plaintext: Uint8Array; encrypted: Uint8Array }>;
  decryptDataKey(encrypted: Uint8Array): Promise<Uint8Array>;
}

export class AwsKmsService implements KeyManagementService {
  private readonly client: KMSClient;
  constructor(public readonly keyId: string, region = process.env.AWS_REGION) {
    if (!keyId) throw new Error("AWS KMS key ID is required");
    this.client = new KMSClient({ region });
  }

  async generateDataKey() {
    const result = await this.client.send(
      new GenerateDataKeyCommand({ KeyId: this.keyId, KeySpec: "AES_256" })
    );
    if (!result.Plaintext || !result.CiphertextBlob) throw new Error("KMS did not return key material");
    return { plaintext: result.Plaintext, encrypted: result.CiphertextBlob };
  }

  async decryptDataKey(encrypted: Uint8Array) {
    const result = await this.client.send(
      new DecryptCommand({ KeyId: this.keyId, CiphertextBlob: encrypted })
    );
    if (!result.Plaintext) throw new Error("KMS did not decrypt the data key");
    return result.Plaintext;
  }
}

/** Local-only KMS substitute. The configured passphrase is never persisted. */
export class LocalKmsService implements KeyManagementService {
  readonly keyId = "local-dev-kms";
  private readonly wrappingKey: Buffer;

  constructor(secret = process.env.DEV_KMS_MASTER_KEY ?? "change-this-local-only-key") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("LocalKmsService is forbidden in production");
    }
    this.wrappingKey = createHash("sha256").update(secret).digest();
  }

  async generateDataKey() {
    const plaintext = randomBytes(32);
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.wrappingKey, nonce);
    const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {
      plaintext,
      encrypted: Buffer.concat([nonce, cipher.getAuthTag(), body])
    };
  }

  async decryptDataKey(encrypted: Uint8Array) {
    const value = Buffer.from(encrypted);
    const decipher = createDecipheriv("aes-256-gcm", this.wrappingKey, value.subarray(0, 12));
    decipher.setAuthTag(value.subarray(12, 28));
    return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]);
  }
}

export type EncryptedSecret = {
  ciphertext: string;
  nonce: string;
  authTag: string;
  encryptedDek: string;
  kmsKeyId: string;
};

export async function encryptSecret(
  plaintext: string,
  kms: KeyManagementService
): Promise<EncryptedSecret> {
  const dataKey = await kms.generateDataKey();
  try {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", dataKey.plaintext, nonce);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return {
      ciphertext: ciphertext.toString("base64"),
      nonce: nonce.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"),
      encryptedDek: Buffer.from(dataKey.encrypted).toString("base64"),
      kmsKeyId: kms.keyId
    };
  } finally {
    Buffer.from(dataKey.plaintext).fill(0);
  }
}

export async function decryptSecret(
  encrypted: EncryptedSecret,
  kms: KeyManagementService
): Promise<string> {
  if (encrypted.kmsKeyId !== kms.keyId) throw new Error("KMS key mismatch");
  const dataKey = await kms.decryptDataKey(Buffer.from(encrypted.encryptedDek, "base64"));
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      dataKey,
      Buffer.from(encrypted.nonce, "base64")
    );
    decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
      decipher.final()
    ]).toString("utf8");
  } finally {
    Buffer.from(dataKey).fill(0);
  }
}

export function createKms(): KeyManagementService {
  return process.env.AWS_KMS_KEY_ID
    ? new AwsKmsService(process.env.AWS_KMS_KEY_ID)
    : new LocalKmsService();
}

export function constructStripeEvent(payload: string | Buffer, signature: string): Stripe.Event {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    throw new Error("Stripe credentials are not configured");
  }
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  return stripe.webhooks.constructEvent(payload, signature, process.env.STRIPE_WEBHOOK_SECRET);
}

export async function applyStripeEvent(client: PoolClient, event: Stripe.Event): Promise<void> {
  if (!event.type.startsWith("customer.subscription.")) return;
  const subscription = event.data.object as Stripe.Subscription;
  await client.query(
    `UPDATE org_billing
       SET stripe_subscription_id = $1,
           period_start = to_timestamp($2),
           period_end = to_timestamp($3),
           kill_switch = $4
     WHERE stripe_customer_id = $5`,
    [
      subscription.id,
      subscription.items.data[0]?.current_period_start ?? 0,
      subscription.items.data[0]?.current_period_end ?? 0,
      subscription.status === "canceled" || subscription.status === "unpaid",
      typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id
    ]
  );
}

export function evaluateManagedUsage(input: {
  includedRemainingUsd: number;
  estimatedCostUsd: number;
  paygOnly: boolean;
  paygEnabled: boolean;
  prepaidBalanceUsd: number;
  overageUsedUsd: number;
  overageSpendCapUsd: number;
  killSwitch: boolean;
}) {
  if (input.killSwitch) return { allowed: false, bucket: "blocked" as const, reason: "kill_switch" as const };
  if (!input.paygOnly && input.estimatedCostUsd <= input.includedRemainingUsd)
    return { allowed: true, bucket: "included" as const };
  // Usage Credits / prepaid grants cover the call without requiring PAYG enrollment.
  if (input.estimatedCostUsd <= input.prepaidBalanceUsd) {
    if (input.paygEnabled && input.overageUsedUsd + input.estimatedCostUsd > input.overageSpendCapUsd) {
      return { allowed: false, bucket: "blocked" as const, reason: "spend_cap" as const };
    }
    return { allowed: true, bucket: input.paygEnabled ? ("payg" as const) : ("prepaid" as const) };
  }
  // Included + prepaid exhausted — hard stop unless PAYG is explicitly enabled with room under the spend cap.
  if (!input.paygEnabled)
    return { allowed: false, bucket: "blocked" as const, reason: "payg_not_enabled" as const };
  if (input.estimatedCostUsd > input.prepaidBalanceUsd)
    return { allowed: false, bucket: "blocked" as const, reason: "insufficient_prepaid_balance" as const };
  if (input.overageUsedUsd + input.estimatedCostUsd > input.overageSpendCapUsd)
    return { allowed: false, bucket: "blocked" as const, reason: "spend_cap" as const };
  return { allowed: true, bucket: "payg" as const };
}

export type PlanEntitlement={
  /** Current ladder codes plus legacy codes still present in old snapshots (0481 remaps org rows). */
  planCode:"free"|"pro"|"pro_plus"|"max"|"team_trial"|"access"|"individual_pro"|"individual_max"|"team_pro"|"team_max"|"managed_20"|"managed_50";
  managedAllowanceUsd:number;
  contextTokenLimit:number;
  agentStepLimit:number;
  cadIterationLimit:number;
  cadConcurrentJobs:number;
  codeAnalysisMb:number;
  jobPriority:number;
  featureFlags:Record<string,boolean>;
};

/**
 * Hosted default: debit at 0.75× typical provider list (~25% cheaper than BYOK at 1.0×).
 * Wholesale ≈ 0.5× is internal only — never surface to users.
 */
export const DEFAULT_SERVICE_MULTIPLIER = CATALOG_SERVICE_MULTIPLIER;

export type TrialPlanCode = "team_trial" | "pro" | "pro_plus" | "max" | "team_pro" | "individual_pro" | "individual_max" | "managed_20" | "managed_50";
export type FreeManagedPolicy={
  enabled:boolean;
  providerCommercialUseApproved:boolean;
  approvalSource:string|null;
  monthlyAllowanceUsd:number;
  monthlyUsedUsd:number;
  orgDailyRequests:number;
  orgDailyLimit:number;
  userDailyRequests:number;
  userDailyLimit:number;
  ipDailyRequests:number;
  ipDailyLimit:number;
  activeRequests:number;
  concurrencyLimit:number;
};
export function evaluateFreeManagedUsage(input:FreeManagedPolicy&{estimatedCostUsd:number;verifiedEmail:boolean;closedTeamMember:boolean}){
  const fallback={offers:["byok","local","upgrade"] as const};
  if(!input.enabled)return{allowed:false as const,reason:"sponsored_ai_unavailable" as const,...fallback};
  if(!input.providerCommercialUseApproved||!input.approvalSource)return{allowed:false as const,reason:"commercial_approval_required" as const,...fallback};
  if(!input.verifiedEmail||!input.closedTeamMember)return{allowed:false as const,reason:"verified_invited_member_required" as const,...fallback};
  if(input.estimatedCostUsd<0)throw new Error("Estimated sponsored cost cannot be negative");
  if(input.monthlyUsedUsd+input.estimatedCostUsd>input.monthlyAllowanceUsd)return{allowed:false as const,reason:"sponsored_allowance_exhausted" as const,...fallback};
  if(input.orgDailyRequests>=input.orgDailyLimit)return{allowed:false as const,reason:"org_rate_limit" as const,...fallback};
  if(input.userDailyRequests>=input.userDailyLimit)return{allowed:false as const,reason:"user_rate_limit" as const,...fallback};
  if(input.ipDailyRequests>=input.ipDailyLimit)return{allowed:false as const,reason:"ip_rate_limit" as const,...fallback};
  if(input.activeRequests>=input.concurrencyLimit)return{allowed:false as const,reason:"low_priority_capacity_busy" as const,...fallback};
  return{allowed:true as const,bucket:"sponsored" as const,priority:"low" as const,remainingAllowanceUsd:input.monthlyAllowanceUsd-input.monthlyUsedUsd-input.estimatedCostUsd};
}
/**
 * Entitlement gate. `releaseFeatureFlags` unlocks staged-release flags for the org's plan
 * (from published product_releases matching audience + min_plan) without rewriting plan snapshots.
 */
export function evaluateEntitlement(input:{entitlement:PlanEntitlement;feature:string;managedProviderCostUsedUsd:number;estimatedManagedCostUsd:number;keySource:"platform"|"byo"|"local"|"local_cli"|"sponsored";releaseFeatureFlags?:Record<string,boolean>}){
  const unlocked=Boolean(input.entitlement.featureFlags[input.feature])||Boolean(input.releaseFeatureFlags?.[input.feature]);
  if(!unlocked)return{allowed:false as const,reason:"feature_not_in_plan" as const,remainingAllowanceUsd:Math.max(0,input.entitlement.managedAllowanceUsd-input.managedProviderCostUsedUsd)};
  const remaining=Math.max(0,input.entitlement.managedAllowanceUsd-input.managedProviderCostUsedUsd);
  if(input.keySource==="byo"||input.keySource==="local"||input.keySource==="local_cli")return{allowed:true as const,bucket:"external_provider" as const,remainingAllowanceUsd:remaining};
  if(input.keySource==="sponsored")return input.estimatedManagedCostUsd<=remaining
    ?{allowed:true as const,bucket:"sponsored" as const,remainingAllowanceUsd:remaining-input.estimatedManagedCostUsd}
    :{allowed:false as const,reason:"managed_allowance_exhausted" as const,remainingAllowanceUsd:remaining};
  if(input.estimatedManagedCostUsd>remaining)return{allowed:false as const,reason:"managed_allowance_exhausted" as const,remainingAllowanceUsd:remaining};
  return{allowed:true as const,bucket:"managed_allowance" as const,remainingAllowanceUsd:remaining-input.estimatedManagedCostUsd};
}

/** Plan rank for min_plan release gates (mirrors SQL product_plan_rank). Legacy codes keep their old ranks. */
export const PLAN_RANK:Record<string,number>={
  free:0,access:10,individual_pro:20,team_pro:20,team_trial:20,managed_20:20,
  individual_max:30,team_max:30,managed_50:30,
  pro:20,pro_plus:25,max:30,
};

export function planMeetsMinPlan(planCode:string,minPlan:string|null|undefined){
  if(!minPlan)return true;
  return (PLAN_RANK[planCode]??0)>=(PLAN_RANK[minPlan]??0);
}

export function mergeReleaseFeatureFlags(base:Record<string,boolean>,releaseFlags:Record<string,boolean>){
  const merged={...base};
  for(const [key,value] of Object.entries(releaseFlags)){
    if(value)merged[key]=true;
  }
  return merged;
}
export function isPlanPeriodActive(period:{periodStart:Date;periodEnd:Date;status:string},now=new Date()){return period.status==="active"&&period.periodStart<=now&&period.periodEnd>now;}

/** Creates a Stripe checkout only when an admin-configured Price ID exists. */
export async function createPlanCheckout(
  client: PoolClient,
  input: { orgId: string; planCode: string; successUrl: string; cancelUrl: string },
) {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("Stripe credentials are not configured");
  const plan = await client.query<{ stripePriceId: string | null; active: boolean }>(
    `SELECT stripe_price_id AS "stripePriceId",active FROM pricing_plans WHERE code=$1`,
    [input.planCode],
  );
  if (!plan.rows[0]?.active || !plan.rows[0].stripePriceId)
    throw new Error("This plan is not configured for checkout");
  const billing = await client.query<{ customerId: string | null }>(
    `SELECT stripe_customer_id AS "customerId" FROM org_billing WHERE org_id=$1`,
    [input.orgId],
  );
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  return stripe.checkout.sessions.create({
    mode: "subscription",
    customer: billing.rows[0]?.customerId ?? undefined,
    line_items: [{ price: plan.rows[0].stripePriceId, quantity: 1 }],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.orgId,
    metadata: { orgId: input.orgId, planCode: input.planCode },
  });
}

export async function createCreditPackCheckout(
  client: PoolClient,
  input: { orgId: string; packCode: string; successUrl: string; cancelUrl: string },
) {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("Stripe credentials are not configured");
  const pack = await client.query<{ stripePriceId: string | null; active: boolean }>(
    `SELECT stripe_price_id AS "stripePriceId",active FROM credit_packs WHERE code=$1`,
    [input.packCode],
  );
  if (!pack.rows[0]?.active || !pack.rows[0].stripePriceId)
    throw new Error("This credit pack is not configured for checkout");
  const billing = await client.query<{ customerId: string | null }>(
    `SELECT stripe_customer_id AS "customerId" FROM org_billing WHERE org_id=$1`,
    [input.orgId],
  );
  return new Stripe(process.env.STRIPE_SECRET_KEY).checkout.sessions.create({
    mode: "payment",
    customer: billing.rows[0]?.customerId ?? undefined,
    line_items: [{ price: pack.rows[0].stripePriceId, quantity: 1 }],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.orgId,
    metadata: { kind: "credit_pack", orgId: input.orgId, packCode: input.packCode },
  });
}

export async function createPaygEnrollment(
  client: PoolClient,
  input: { orgId: string; successUrl: string; cancelUrl: string },
) {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("Stripe credentials are not configured");
  const billing = await client.query<{ customerId: string | null }>(
    `SELECT stripe_customer_id AS "customerId" FROM org_billing WHERE org_id=$1`,
    [input.orgId],
  );
  return new Stripe(process.env.STRIPE_SECRET_KEY).checkout.sessions.create({
    mode: "setup",
    customer: billing.rows[0]?.customerId ?? undefined,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.orgId,
    metadata: { kind: "payg_enrollment", orgId: input.orgId },
  });
}

export async function createCustomerPortal(
  client: PoolClient,
  input: { orgId: string; returnUrl: string },
) {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("Stripe credentials are not configured");
  const billing = await client.query<{ customerId: string | null }>(
    `SELECT stripe_customer_id AS "customerId" FROM org_billing WHERE org_id=$1`,
    [input.orgId],
  );
  if (!billing.rows[0]?.customerId) throw new Error("No Stripe customer is linked");
  return new Stripe(process.env.STRIPE_SECRET_KEY).billingPortal.sessions.create({
    customer: billing.rows[0].customerId,
    return_url: input.returnUrl,
  });
}

async function notifyOrgAdmins(
  client: PoolClient,
  orgId: string,
  type: string,
  payload: Record<string, unknown>,
) {
  await client.query(
    `INSERT INTO notifications(user_id,org_id,type,payload)
     SELECT user_id,$1,$2,$3::jsonb FROM memberships
     WHERE org_id=$1 AND role IN ('owner','admin')`,
    [orgId, type, JSON.stringify(payload)],
  );
}

/** Run inside a transaction using the least-privilege billing connection. */
export async function processStripeEvent(client: PoolClient, event: Stripe.Event) {
  const claimed = await client.query(
    `INSERT INTO stripe_webhook_events(event_id,type) VALUES($1,$2)
     ON CONFLICT(event_id) DO NOTHING`,
    [event.id, event.type],
  );
  if (!claimed.rowCount) return { duplicate: true };
  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const orgId = session.metadata?.orgId;
      if (session.metadata?.kind === "credit_pack" && orgId && session.metadata.packCode) {
        await client.query(
          `INSERT INTO wallet_ledger(org_id,amount_usd,kind,stripe_event_id,reference_id,reason)
           SELECT $1,credit_amount_usd,'purchase',$2,$3,'Vantage Usage Credits purchase'
           FROM credit_packs WHERE code=$3`,
          [orgId, event.id, session.metadata.packCode],
        );
        await notifyOrgAdmins(client, orgId, "credits.purchased", { packCode: session.metadata.packCode });
      } else if (session.metadata?.kind === "payg_enrollment" && orgId) {
        await client.query(
          `INSERT INTO org_usage_policies(org_id,payg_enabled) VALUES($1,true)
           ON CONFLICT(org_id) DO UPDATE SET payg_enabled=true,updated_at=now()`,
          [orgId],
        );
      }
    } else if (event.type.startsWith("customer.subscription.")) {
      const subscription = event.data.object as Stripe.Subscription;
      const orgId = subscription.metadata.orgId;
      const planCode = subscription.metadata.planCode;
      if (orgId && planCode) {
        const entitled = ["active", "trialing"].includes(subscription.status);
        const validUntil = subscription.items.data[0]?.current_period_end;
        await client.query(
          `INSERT INTO org_entitlements(org_id,plan_code,source,status,stripe_subscription_id,valid_until)
           VALUES($1,$2,'stripe',$3,$4,to_timestamp($5))
           ON CONFLICT(org_id) DO UPDATE SET plan_code=excluded.plan_code,source='stripe',
            status=excluded.status,stripe_subscription_id=excluded.stripe_subscription_id,
            valid_until=excluded.valid_until,updated_at=now()`,
          [orgId, planCode, entitled ? "active" : subscription.status, subscription.id, validUntil ?? 0],
        );
        await client.query(
          `INSERT INTO entitlement_events(org_id,plan_code,action,source,stripe_event_id,metadata)
           VALUES($1,$2,$3,'stripe',$4,$5::jsonb)`,
          [orgId, planCode, entitled ? "activated" : "suspended", event.id, JSON.stringify({ status: subscription.status })],
        );
        if (!entitled) await notifyOrgAdmins(client, orgId, "subscription.action_required", { status: subscription.status });
      }
      await applyStripeEvent(client, event);
    } else if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId =
        typeof invoice.parent?.subscription_details?.subscription === "string"
          ? invoice.parent.subscription_details.subscription
          : invoice.parent?.subscription_details?.subscription?.id;
      if (subscriptionId) {
        const org = await client.query<{ orgId: string }>(
          `SELECT org_id AS "orgId" FROM org_entitlements WHERE stripe_subscription_id=$1`,
          [subscriptionId],
        );
        if (org.rows[0]) await notifyOrgAdmins(client, org.rows[0].orgId, "subscription.payment_failed", {});
      }
    }
    await client.query(
      `UPDATE stripe_webhook_events SET status='processed',processed_at=now() WHERE event_id=$1`,
      [event.id],
    );
    return { duplicate: false };
  } catch (error) {
    await client.query(
      `UPDATE stripe_webhook_events SET status='failed',error=$2,processed_at=now() WHERE event_id=$1`,
      [event.id, error instanceof Error ? error.message.slice(0, 500) : "Webhook failed"],
    );
    throw error;
  }
}

export async function giftUsageCredits(
  client: PoolClient,
  input: { orgId: string; amountUsd: number; actorUserId: string; reason: string },
) {
  if (!(input.amountUsd > 0) || !input.reason.trim()) throw new Error("Positive amount and reason are required");
  await client.query(
    `INSERT INTO wallet_ledger(org_id,amount_usd,kind,actor_user_id,reason)
     VALUES($1,$2,'gift',$3,$4)`,
    [input.orgId, input.amountUsd, input.actorUserId, input.reason.trim()],
  );
  await notifyOrgAdmins(client, input.orgId, "credits.gifted", {
    amountUsd: input.amountUsd,
    reason: input.reason,
  });
}

export async function grantTrial(
  client: PoolClient,
  input: { orgId: string; planCode: TrialPlanCode; actorUserId: string; creditsCapUsd?: number },
) {
  const allowed: TrialPlanCode[] = ["team_trial", "pro", "pro_plus", "max", "team_pro", "individual_pro", "individual_max", "managed_20", "managed_50"];
  if (!allowed.includes(input.planCode)) throw new Error("Invalid trial plan");
  const planCode = input.planCode === "managed_20" || input.planCode === "managed_50" ? "team_trial" : input.planCode;
  const creditsCap = input.creditsCapUsd ?? 30;
  const startsAt = new Date();
  const expiresAt = new Date(startsAt.getTime() + 7 * 24 * 60 * 60 * 1000);
  await client.query(
    `INSERT INTO org_entitlements(org_id,plan_code,source,status,trial_ends_at,valid_until,updated_by)
     VALUES($1,$2,'admin_trial','active',$3,$3,$4)
     ON CONFLICT(org_id) DO UPDATE SET plan_code=excluded.plan_code,source='admin_trial',
      status='active',trial_ends_at=$3,valid_until=$3,updated_by=$4,updated_at=now()`,
    [input.orgId, planCode, expiresAt, input.actorUserId],
  );
  const entitlement = await client.query<{ id: string; managedAllowanceUsd: string }>(
    `SELECT id, managed_allowance_usd AS "managedAllowanceUsd"
     FROM plan_entitlement_versions
     WHERE plan_code=$1 AND effective_at<=$2
     ORDER BY version DESC LIMIT 1`,
    [planCode, startsAt],
  );
  const allowance = Number(entitlement.rows[0]?.managedAllowanceUsd ?? creditsCap);
  if (entitlement.rows[0]?.id) {
    await client.query(
      `INSERT INTO org_plan_periods(org_id,plan_code,entitlement_version_id,period_start,period_end,managed_allowance_usd,status)
       VALUES($1,$2,$3,$4,$5,$6,'active')
       ON CONFLICT(org_id,period_start) DO UPDATE SET
         plan_code=excluded.plan_code,entitlement_version_id=excluded.entitlement_version_id,
         period_end=excluded.period_end,managed_allowance_usd=excluded.managed_allowance_usd,status='active'`,
      [input.orgId, planCode, entitlement.rows[0].id, startsAt, expiresAt, Math.min(allowance, creditsCap)],
    );
  }
  await client.query(
    `INSERT INTO entitlement_events(org_id,plan_code,action,source,expires_at,actor_user_id,metadata)
     VALUES($1,$2,'trial_granted','admin',$3,$4,$5::jsonb)`,
    [input.orgId, planCode, expiresAt, input.actorUserId, JSON.stringify({ creditsCapUsd: creditsCap, autoCharge: false })],
  );
  await notifyOrgAdmins(client, input.orgId, "trial.granted", {
    planCode,
    creditsCapUsd: creditsCap,
    expiresAt: expiresAt.toISOString(),
    autoCharge: false,
  });
  return expiresAt;
}

export async function expireTrials(client: PoolClient, now = new Date()) {
  const expired = await client.query<{ orgId: string; planCode: string }>(
    `UPDATE org_entitlements SET status='expired',updated_at=now()
     WHERE source='admin_trial' AND status='active' AND valid_until <= $1
     RETURNING org_id AS "orgId",plan_code AS "planCode"`,
    [now],
  );
  for (const trial of expired.rows) {
    await client.query(
      `INSERT INTO entitlement_events(org_id,plan_code,action,source,effective_at)
       VALUES($1,$2,'trial_expired','system',$3)`,
      [trial.orgId, trial.planCode, now],
    );
    await notifyOrgAdmins(client, trial.orgId, "trial.expired", { planCode: trial.planCode });
  }
  return expired.rowCount ?? 0;
}
