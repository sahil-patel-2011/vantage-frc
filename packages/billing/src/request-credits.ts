import type { PoolClient } from "@neondatabase/serverless";

/**
 * Request-denominated AI credits.
 *
 * The dollar path (org_billing.credit_cap_usd + ai_usage_events.cost_usd) still tracks
 * what a call actually cost the platform. This module is the separate, human-legible
 * budget: "your team has 500 AI requests left". One plain chat turn spends one credit;
 * an agentic run that fans out into many model calls spends more, because it genuinely
 * drives more provider traffic.
 *
 * Balance is always SUM(ledger) — never a denormalized counter — matching how the
 * dollar ledger works in index.ts.
 */

export type RequestKind =
  | "chat"
  | "agentic"
  | "background"
  | "stt"
  | "embedding"
  | "deterministic";

export const REQUEST_KINDS: readonly RequestKind[] = [
  "chat",
  "agentic",
  "background",
  "stt",
  "embedding",
  "deterministic",
];

/** Fallbacks used only when the ai_credit_weights table has not been read yet. */
export const DEFAULT_REQUEST_CREDIT_WEIGHTS: Record<RequestKind, number> = {
  chat: 1,
  agentic: 4,
  background: 1,
  stt: 1,
  embedding: 0,
  deterministic: 0,
};

/**
 * Features whose `invoke` runs a multi-step loop with tool calls. These are the ones
 * documented as agent-shaped in docs/LOCAL_AI.md; each one can issue many model turns
 * per user action, so a flat 1 credit would badly under-count them.
 */
const AGENTIC_FEATURES = new Set([
  "agent",
  "cad",
  "coding",
  "bugbot",
  "bugbot_ultra",
  "team_dream",
  "team_dream_week",
  "memory_dream",
  "overnight_intel",
  "deep_game_analysis",
]);

/** Features that never touch an external model — metered for accounting only. */
const DETERMINISTIC_FEATURES = new Set([
  "alliance-partner-brief",
  "budget_reconciler",
  "cad_change_radar",
  "code_perf",
  "decision_critic",
  "decision_search",
  "defense_planner",
  "grant_report_generate",
  "impact_essay",
  "inspection_copilot",
  "judge_sim",
  "knowledge_gap",
  "matching_gift_finder",
  "media_post_draft",
  "media_kit_one_pager",
  "meeting_autopilot",
  "mock_judging",
  "onboarding_buddy",
  "picklist-justifier",
  "pit_repair_triage",
  "prototype_tracker",
  "readiness_score",
  "retro_postmortem",
  "reuse_advisor",
  "rule_impact",
  "skills_graph",
  "spare_forecast",
  "spare_robot_kit",
  "sponsor_renewal_roi",
  "sponsor_suite_deck",
  "sponsor_suite_roi_report",
  "standup_digest",
  "tuning_autopilot",
  "wiring_diagnoser",
]);

const BACKGROUND_FEATURES = new Set(["bugbot_scan", "performance_digest"]);

/**
 * Best-effort default kind for a feature id. Callers that know better (for example an
 * agent loop reporting how many steps it actually ran) should pass the kind explicitly
 * rather than relying on this.
 */
export function requestKindForFeature(feature: string | null | undefined): RequestKind {
  const key = (feature ?? "").trim().toLowerCase();
  if (!key) return "chat";
  if (DETERMINISTIC_FEATURES.has(key)) return "deterministic";
  if (AGENTIC_FEATURES.has(key)) return "agentic";
  if (BACKGROUND_FEATURES.has(key)) return "background";
  if (key.startsWith("bugbot")) return "agentic";
  if (key.endsWith("_stt") || key.includes("transcribe")) return "stt";
  if (key.includes("embedding")) return "embedding";
  return "chat";
}

export function isRequestKind(value: unknown): value is RequestKind {
  return typeof value === "string" && (REQUEST_KINDS as readonly string[]).includes(value);
}

/**
 * Credits for one call. `steps` lets an agent loop bill proportionally to the model
 * turns it really made instead of a flat guess; it never reduces the base weight.
 */
export function creditsForRequest(input: {
  kind: RequestKind;
  weights?: Partial<Record<RequestKind, number>>;
  steps?: number;
}): number {
  const base = input.weights?.[input.kind] ?? DEFAULT_REQUEST_CREDIT_WEIGHTS[input.kind];
  if (!Number.isFinite(base) || base <= 0) return 0;
  if (input.kind !== "agentic") return Math.round(base);
  const steps = Number.isFinite(input.steps) ? Math.max(1, Math.floor(input.steps as number)) : 1;
  // An agentic run costs the base weight once, plus the base weight for each extra
  // model turn beyond the first. One-step agent runs therefore cost exactly the base.
  return Math.round(base * steps);
}

export type CreditLedgerRow = {
  entryKind: "grant" | "consumption" | "revoke" | "expiry";
  credits: number;
  expiresAt?: string | Date | null;
};

export type RequestCreditBalance = {
  granted: number;
  spent: number;
  balance: number;
};

/** Pure balance math — expired grants simply stop counting. */
export function resolveRequestCreditBalance(
  rows: CreditLedgerRow[],
  now: Date = new Date(),
): RequestCreditBalance {
  let granted = 0;
  let spent = 0;
  for (const row of rows) {
    if (row.entryKind === "grant") {
      const expires = row.expiresAt ? new Date(row.expiresAt) : null;
      if (expires && expires.getTime() <= now.getTime()) continue;
      granted += row.credits;
    } else {
      spent += Math.abs(row.credits);
    }
  }
  return { granted, spent, balance: granted - spent };
}

export class RequestCreditsExhaustedError extends Error {
  readonly code = "request_credits_exhausted";
  constructor(readonly needed: number, readonly available: number) {
    super(
      `This team is out of AI request credits (needed ${needed}, ${available} left). ` +
        `Ask a platform admin to add more, or connect your own AI key under Team → AI API keys.`,
    );
    this.name = "RequestCreditsExhaustedError";
  }
}

export async function loadRequestCreditWeights(
  client: PoolClient,
): Promise<Record<RequestKind, number>> {
  const result = await client.query<{ request_kind: RequestKind; credits: number }>(
    `SELECT request_kind, credits FROM ai_credit_weights`,
  );
  const weights = { ...DEFAULT_REQUEST_CREDIT_WEIGHTS };
  for (const row of result.rows) {
    if (isRequestKind(row.request_kind)) weights[row.request_kind] = Number(row.credits);
  }
  return weights;
}

export async function loadRequestCreditBalance(
  client: PoolClient,
  orgId: string,
): Promise<RequestCreditBalance> {
  const result = await client.query<{ granted: string; spent: string; balance: string }>(
    `SELECT granted, spent, balance FROM org_ai_request_credits WHERE org_id = $1::uuid`,
    [orgId],
  );
  const row = result.rows[0];
  if (!row) return { granted: 0, spent: 0, balance: 0 };
  return { granted: Number(row.granted), spent: Number(row.spent), balance: Number(row.balance) };
}

/**
 * Whether this org is funded by request credits at all. A team on its own key (BYOK or
 * local) has never been granted credits and must not be blocked by this budget — the
 * absence of any grant means "not on the credit plan", not "out of credits".
 */
export async function orgUsesRequestCredits(
  client: PoolClient,
  orgId: string,
): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM ai_request_credit_ledger
        WHERE org_id = $1::uuid AND entry_kind = 'grant'
     ) AS exists`,
    [orgId],
  );
  return result.rows[0]?.exists === true;
}

/** Platform-admin grant. Positive credits only; expiry is optional. */
export async function grantRequestCredits(
  client: PoolClient,
  input: {
    orgId: string;
    credits: number;
    actorUserId: string;
    reason?: string;
    expiresAt?: Date | null;
    metadata?: Record<string, unknown>;
  },
): Promise<string> {
  const credits = Math.floor(input.credits);
  if (!Number.isFinite(credits) || credits <= 0) {
    throw new Error("Grant must be a positive whole number of credits");
  }
  const result = await client.query<{ id: string }>(
    `INSERT INTO ai_request_credit_ledger
       (org_id, entry_kind, credits, expires_at, actor_user_id, reason, metadata)
     VALUES ($1::uuid, 'grant', $2, $3, $4::uuid, $5, $6::jsonb)
     RETURNING id`,
    [
      input.orgId,
      credits,
      input.expiresAt ?? null,
      input.actorUserId,
      input.reason ?? "",
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return result.rows[0]!.id;
}

/**
 * Spend credits for one metered call. Reuses the caller's `requestId` as the ledger
 * idempotency key, so a retry that reaches this twice charges once.
 *
 * Returns the credits actually charged (0 when the org is not on the credit plan or
 * the request kind is free).
 */
export async function chargeRequestCredits(
  client: PoolClient,
  input: {
    orgId: string;
    requestId: string;
    feature: string;
    kind?: RequestKind;
    steps?: number;
    weights?: Partial<Record<RequestKind, number>>;
  },
): Promise<number> {
  if (!(await orgUsesRequestCredits(client, input.orgId))) return 0;

  const kind = input.kind ?? requestKindForFeature(input.feature);
  const weights = input.weights ?? (await loadRequestCreditWeights(client));
  const credits = creditsForRequest({ kind, weights, steps: input.steps });
  if (credits <= 0) return 0;

  const { balance } = await loadRequestCreditBalance(client, input.orgId);
  if (balance < credits) throw new RequestCreditsExhaustedError(credits, Math.max(0, balance));

  await client.query(
    `INSERT INTO ai_request_credit_ledger
       (org_id, entry_kind, credits, request_kind, feature, request_id, reason)
     VALUES ($1::uuid, 'consumption', $2, $3, $4, $5, '')
     ON CONFLICT (request_id) DO NOTHING`,
    [input.orgId, -credits, kind, input.feature, input.requestId],
  );
  return credits;
}

/**
 * Read-only pre-call half of {@link chargeRequestCredits}: what this call will cost,
 * and whether the org can afford it. Returns 0 when the org is not on the credit plan
 * or the request kind is free, in which case nothing should be recorded at settle.
 *
 * Separate from the write so a streamed response can be denied before its first token
 * and recorded after its last — the same reason meteredAI splits authorize from settle.
 */
export async function authorizeRequestCredits(
  client: PoolClient,
  input: {
    orgId: string;
    feature: string;
    kind?: RequestKind;
    steps?: number;
    weights?: Partial<Record<RequestKind, number>>;
  },
): Promise<number> {
  if (!(await orgUsesRequestCredits(client, input.orgId))) return 0;

  const kind = input.kind ?? requestKindForFeature(input.feature);
  const weights = input.weights ?? (await loadRequestCreditWeights(client));
  const credits = creditsForRequest({ kind, weights, steps: input.steps });
  if (credits <= 0) return 0;

  const { balance } = await loadRequestCreditBalance(client, input.orgId);
  if (balance < credits) throw new RequestCreditsExhaustedError(credits, Math.max(0, balance));
  return credits;
}

/**
 * Append-only settle half. Deliberately never throws to deny: the provider has already
 * served the call, so refusing to record it would hand the org unbilled AI. A balance
 * that went negative between authorize and settle is recorded honestly and shows up as
 * a negative balance rather than being silently dropped.
 */
export async function recordRequestCreditConsumption(
  client: PoolClient,
  input: {
    orgId: string;
    requestId: string;
    feature: string;
    credits: number;
    kind?: RequestKind;
  },
): Promise<void> {
  if (input.credits <= 0) return;
  const kind = input.kind ?? requestKindForFeature(input.feature);
  await client.query(
    `INSERT INTO ai_request_credit_ledger
       (org_id, entry_kind, credits, request_kind, feature, request_id, reason)
     VALUES ($1::uuid, 'consumption', $2, $3, $4, $5, '')
     ON CONFLICT (request_id) DO NOTHING`,
    [input.orgId, -input.credits, kind, input.feature, input.requestId],
  );
}

export type OrgAiAccessKind = "platform_relay" | "sponsored_pool" | "hosted_platform";

export type OrgAiAccessGrant = {
  id: string;
  accessKind: OrgAiAccessKind;
  startsAt: string;
  endsAt: string;
  note: string;
};

/** Active, non-revoked platform AI access windows for this org, right now. */
export async function loadOrgAiAccessGrants(
  client: PoolClient,
  orgId: string,
  now: Date = new Date(),
): Promise<OrgAiAccessGrant[]> {
  const result = await client.query<{
    id: string;
    accessKind: OrgAiAccessKind;
    startsAt: Date;
    endsAt: Date;
    note: string;
  }>(
    `SELECT id, access_kind AS "accessKind", starts_at AS "startsAt", ends_at AS "endsAt", note
       FROM org_ai_access_grants
      WHERE org_id = $1::uuid
        AND revoked_at IS NULL
        AND starts_at <= $2
        AND ends_at > $2
      ORDER BY ends_at DESC`,
    [orgId, now],
  );
  return result.rows.map((row) => ({
    id: row.id,
    accessKind: row.accessKind,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    note: row.note,
  }));
}

export async function hasOrgAiAccess(
  client: PoolClient,
  orgId: string,
  kind: OrgAiAccessKind,
  now: Date = new Date(),
): Promise<boolean> {
  const grants = await loadOrgAiAccessGrants(client, orgId, now);
  return grants.some((grant) => grant.accessKind === kind);
}
