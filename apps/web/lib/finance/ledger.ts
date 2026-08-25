/**
 * ONE MONEY LEDGER — the single write path onto the unified finance spine.
 *
 * Migration 0461_money_unify.sql made finance_transactions the one table every
 * money-shaped row lands in, keyed by (org_id, source_kind, source_id) with a
 * partial UNIQUE index so mirror writes are idempotent upserts:
 *
 *   source 'manual'            — typed straight into the ledger (no source_id)
 *   source 'purchase_request'  — a committed /orders row (purchase_requests)
 *   source 'purchase_log'      — a Business-desk receipt (finance_purchase_log)
 *   source 'season_cost'       — a paid /costs row (season_costs)
 *   source 'bom'               — an absorbed BOM estimate (counts_in_balance=false)
 *   source 'reimbursement'     — a PAID reimbursement_requests claim (0482). An
 *     approved-but-unpaid claim is a promise, not cash, and never mirrors.
 *   source 'sponsor_contribution' / 'fundraiser' — income mirrors whose dollars
 *     are counted from their own tables (sponsor_contributions / fundraiser_events)
 *
 * Surfaces that write one of the legacy tables call recordMoney()/removeMoney()
 * in the SAME withRls transaction as their own write, so the ledger can never
 * drift from the source row. Consumers not yet repointed are covered by the
 * fallback unions in balance.ts (rows whose (source, source_id) is absent from
 * the ledger), so nothing is ever counted twice — see dedupeLedgerEntries.
 *
 * Everything here is parameterized SQL under the caller's RLS context. The
 * pure helpers (normalize/dedupe/sum/rollup) are unit-tested in ledger.test.ts.
 */

import type { PoolClient } from "@neondatabase/serverless";

export const MONEY_SOURCES = [
  "manual",
  "sponsor_contribution",
  "fundraiser",
  "other",
  "purchase_request",
  "purchase_log",
  "season_cost",
  "bom",
  "reimbursement",
] as const;

export type MoneySource = (typeof MONEY_SOURCES)[number];

export type MoneyDirection = "in" | "out";

/** Human chip label for a ledger row's origin, shown next to every entry. */
export const MONEY_SOURCE_LABELS: Record<MoneySource, string> = {
  manual: "Manual",
  sponsor_contribution: "Sponsor",
  fundraiser: "Fundraiser",
  other: "Other",
  purchase_request: "Order",
  purchase_log: "Receipt",
  season_cost: "Season cost",
  bom: "BOM estimate",
  reimbursement: "Reimbursement",
};

export type RecordMoneyInput = {
  orgId: string;
  source: MoneySource;
  /** Primary key of the mirrored source row. Required for every non-manual source. */
  sourceId: string | null;
  direction: MoneyDirection;
  amountUsd: number;
  seasonYear: number;
  categoryId?: string | null;
  /** One line naming the money movement — becomes the ledger description. */
  label?: string | null;
  occurredAt?: string | Date | null;
  /**
   * Acting user. Optional because some mirror hooks run where only the RLS
   * context knows the user — the SQL falls back to current_app_user_id().
   */
  createdBy?: string | null;
  /** False only for money-shaped rows that are not cash (BOM estimates). */
  countsInBalance?: boolean;
};

export type NormalizedRecordMoney = {
  orgId: string;
  source: MoneySource;
  sourceId: string | null;
  type: "income" | "expense";
  /** Legacy 0035 source enum value kept in sync for one release of old readers. */
  legacySource: "purchase_request" | "sponsor_contribution" | "manual" | "fundraiser" | "other";
  amountUsd: number;
  seasonYear: number;
  categoryId: string | null;
  label: string | null;
  occurredAt: string | null;
  createdBy: string | null;
  countsInBalance: boolean;
  /** Legacy FK columns 0035-era readers still join on. */
  purchaseRequestId: string | null;
  sponsorContributionId: string | null;
};

export function isMoneySource(value: unknown): value is MoneySource {
  return typeof value === "string" && (MONEY_SOURCES as readonly string[]).includes(value);
}

/** Round to whole cents; reject non-finite or negative amounts — money is never invented. */
export function normalizeAmountUsd(value: number): number {
  if (!Number.isFinite(value)) throw new Error("Amount must be a finite number of dollars.");
  const cents = Math.round(value * 100);
  if (cents < 0) throw new Error("Amount must be zero or greater.");
  return cents / 100;
}

export function normalizeRecordMoney(input: RecordMoneyInput): NormalizedRecordMoney {
  if (!isMoneySource(input.source)) throw new Error("Unknown money source.");
  if (input.direction !== "in" && input.direction !== "out") {
    throw new Error("Money direction must be 'in' or 'out'.");
  }
  if (input.source !== "manual" && !input.sourceId) {
    throw new Error(`A ${input.source} ledger row needs the source row's id to stay idempotent.`);
  }
  const label = typeof input.label === "string" ? input.label.trim().slice(0, 500) || null : null;
  const occurredAt =
    input.occurredAt instanceof Date
      ? input.occurredAt.toISOString()
      : typeof input.occurredAt === "string" && input.occurredAt.trim()
        ? input.occurredAt
        : null;
  return {
    orgId: input.orgId,
    source: input.source,
    sourceId: input.sourceId ?? null,
    type: input.direction === "in" ? "income" : "expense",
    legacySource:
      input.source === "purchase_request" ||
      input.source === "sponsor_contribution" ||
      input.source === "manual" ||
      input.source === "fundraiser"
        ? input.source
        : "other",
    amountUsd: normalizeAmountUsd(input.amountUsd),
    seasonYear: input.seasonYear,
    categoryId: input.categoryId ?? null,
    label,
    occurredAt,
    createdBy: input.createdBy ?? null,
    countsInBalance: input.countsInBalance ?? true,
    purchaseRequestId: input.source === "purchase_request" ? (input.sourceId ?? null) : null,
    sponsorContributionId: input.source === "sponsor_contribution" ? (input.sourceId ?? null) : null,
  };
}

/**
 * Idempotent upsert onto the unified ledger. The conflict target is the partial
 * unique index from 0461 — calling twice with the same (org, source, sourceId)
 * updates the one row instead of inserting a second.
 */
export const RECORD_MONEY_UPSERT_SQL = `
  INSERT INTO finance_transactions
    (org_id, season_year, type, source, amount_usd, occurred_at, category_id,
     purchase_request_id, sponsor_contribution_id, description, created_by,
     source_kind, source_id, counts_in_balance)
  VALUES ($1::uuid, $2::int, $3::finance_txn_type, $4::finance_txn_source, $5::numeric,
          COALESCE($6::timestamptz, now()), $7::uuid, $8::uuid, $9::uuid, $10,
          COALESCE($11::uuid, current_app_user_id()), $12, $13::uuid, $14::boolean)
  ON CONFLICT (org_id, source_kind, source_id) WHERE source_id IS NOT NULL
  DO UPDATE SET
    season_year = EXCLUDED.season_year,
    type = EXCLUDED.type,
    amount_usd = EXCLUDED.amount_usd,
    occurred_at = EXCLUDED.occurred_at,
    category_id = EXCLUDED.category_id,
    description = EXCLUDED.description,
    counts_in_balance = EXCLUDED.counts_in_balance`;

/** Plain insert for manual rows — repeated manual entries are legitimately distinct. */
export const RECORD_MONEY_INSERT_SQL = `
  INSERT INTO finance_transactions
    (org_id, season_year, type, source, amount_usd, occurred_at, category_id,
     purchase_request_id, sponsor_contribution_id, description, created_by,
     source_kind, source_id, counts_in_balance)
  VALUES ($1::uuid, $2::int, $3::finance_txn_type, $4::finance_txn_source, $5::numeric,
          COALESCE($6::timestamptz, now()), $7::uuid, $8::uuid, $9::uuid, $10,
          COALESCE($11::uuid, current_app_user_id()), $12, $13::uuid, $14::boolean)`;

export function recordMoneyParams(row: NormalizedRecordMoney): unknown[] {
  return [
    row.orgId,
    row.seasonYear,
    row.type,
    row.legacySource,
    row.amountUsd,
    row.occurredAt,
    row.categoryId,
    row.purchaseRequestId,
    row.sponsorContributionId,
    row.label,
    row.createdBy,
    row.source,
    row.sourceId,
    row.countsInBalance,
  ];
}

/**
 * The single write path onto the money spine. Call inside the SAME withRls
 * transaction as the source-table write so ledger and source can never drift.
 */
export async function recordMoney(client: PoolClient, input: RecordMoneyInput): Promise<void> {
  const row = normalizeRecordMoney(input);
  const sql = row.sourceId ? RECORD_MONEY_UPSERT_SQL : RECORD_MONEY_INSERT_SQL;
  await client.query(sql, recordMoneyParams(row));
}

/** Remove the mirror row when its source row is deleted or stops qualifying. */
export async function removeMoney(
  client: PoolClient,
  input: { orgId: string; source: MoneySource; sourceId: string },
): Promise<void> {
  await client.query(
    `DELETE FROM finance_transactions
     WHERE org_id = $1::uuid AND source_kind = $2 AND source_id = $3::uuid`,
    [input.orgId, input.source, input.sourceId],
  );
}

// ---------------------------------------------------------------- unified read model

export type UnifiedLedgerEntry = {
  /** Row id in whichever table produced the entry — only unique per (mirrored, source). */
  id: string;
  date: string;
  label: string;
  amountUsd: number;
  direction: MoneyDirection;
  source: MoneySource;
  sourceId: string | null;
  categoryId: string | null;
  categoryName: string | null;
  /** True when the entry is a real finance_transactions row; false for a legacy-table fallback. */
  mirrored: boolean;
};

export function ledgerEntryKey(entry: Pick<UnifiedLedgerEntry, "source" | "sourceId">): string | null {
  return entry.sourceId ? `${entry.source}:${entry.sourceId}` : null;
}

/**
 * THE dedup rule of the unification: a legacy-table row whose (source, sourceId)
 * already exists as a mirrored ledger row is the SAME dollar and is dropped.
 * Mirrored rows win regardless of input order; entries without a sourceId
 * (manual income/expense) are never merged with each other. The SQL in
 * balance.ts applies the same rule via NOT EXISTS — this pure pass is the
 * tested specification and a defense in depth over whatever rows arrive.
 */
export function dedupeLedgerEntries(entries: readonly UnifiedLedgerEntry[]): UnifiedLedgerEntry[] {
  const byKey = new Map<string, UnifiedLedgerEntry>();
  const keyless: UnifiedLedgerEntry[] = [];
  const order: string[] = [];
  for (const entry of entries) {
    const key = ledgerEntryKey(entry);
    if (!key) {
      keyless.push(entry);
      continue;
    }
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, entry);
      order.push(key);
    } else if (!existing.mirrored && entry.mirrored) {
      byKey.set(key, entry); // the ledger row is canonical
    }
  }
  return [...order.map((key) => byKey.get(key)!), ...keyless];
}

export function sumLedgerEntries(entries: readonly UnifiedLedgerEntry[]): {
  inUsd: number;
  outUsd: number;
  balanceUsd: number;
} {
  let inCents = 0;
  let outCents = 0;
  for (const entry of entries) {
    const cents = Math.round(entry.amountUsd * 100);
    if (!Number.isFinite(cents) || cents <= 0) continue;
    if (entry.direction === "in") inCents += cents;
    else outCents += cents;
  }
  return { inUsd: inCents / 100, outUsd: outCents / 100, balanceUsd: (inCents - outCents) / 100 };
}

export type LedgerCategoryRollup = {
  categoryId: string | null;
  name: string;
  inUsd: number;
  outUsd: number;
};

export function rollupLedgerByCategory(
  entries: readonly UnifiedLedgerEntry[],
  limit = 25,
): LedgerCategoryRollup[] {
  const buckets = new Map<string, { categoryId: string | null; name: string; inCents: number; outCents: number }>();
  for (const entry of entries) {
    const cents = Math.round(entry.amountUsd * 100);
    if (!Number.isFinite(cents) || cents <= 0) continue;
    const key = entry.categoryId ?? "";
    const bucket = buckets.get(key) ?? {
      categoryId: entry.categoryId,
      name: entry.categoryId ? (entry.categoryName ?? "Uncategorized") : "Uncategorized",
      inCents: 0,
      outCents: 0,
    };
    if (entry.direction === "in") bucket.inCents += cents;
    else bucket.outCents += cents;
    buckets.set(key, bucket);
  }
  return [...buckets.values()]
    .filter((bucket) => bucket.inCents !== 0 || bucket.outCents !== 0)
    .sort(
      (a, b) =>
        b.outCents - a.outCents || b.inCents - a.inCents || a.name.localeCompare(b.name),
    )
    .slice(0, limit)
    .map((bucket) => ({
      categoryId: bucket.categoryId,
      name: bucket.name,
      inUsd: bucket.inCents / 100,
      outUsd: bucket.outCents / 100,
    }));
}

/**
 * Split deduped entries into the balance components: mirrored rows are the
 * ledger; legacy-only rows report as the per-source fallback amounts so the
 * Business view can show how much money still lives outside the spine.
 */
export function splitLedgerComponents(entries: readonly UnifiedLedgerEntry[]): {
  ledgerInUsd: number;
  ledgerOutUsd: number;
  purchaseRequestsUsd: number;
  purchaseLogUsd: number;
  seasonCostsPaidUsd: number;
} {
  let ledgerIn = 0;
  let ledgerOut = 0;
  let requests = 0;
  let log = 0;
  let costs = 0;
  for (const entry of entries) {
    const cents = Math.round(entry.amountUsd * 100);
    if (!Number.isFinite(cents) || cents <= 0) continue;
    if (entry.mirrored) {
      if (entry.direction === "in") ledgerIn += cents;
      else ledgerOut += cents;
    } else if (entry.source === "purchase_request") requests += cents;
    else if (entry.source === "purchase_log") log += cents;
    else if (entry.source === "season_cost") costs += cents;
    else if (entry.direction === "in") ledgerIn += cents;
    else ledgerOut += cents;
  }
  return {
    ledgerInUsd: ledgerIn / 100,
    ledgerOutUsd: ledgerOut / 100,
    purchaseRequestsUsd: requests / 100,
    purchaseLogUsd: log / 100,
    seasonCostsPaidUsd: costs / 100,
  };
}
