/**
 * Write path for grant_finance_allocations. Grant reports attribute ONLY these
 * rows — never season-wide finance_transactions totals. Callers must name one
 * ledger transaction and an amount > 0; nothing here copies a season sum.
 */

import type { PoolClient } from "@neondatabase/serverless";
import { GRANT_SPEND_SCHEMA_BLOCKER } from ".";
import { GRANT_FINANCE_ALLOCATIONS_TABLE } from "./spend-linkage";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GRANT_ALLOCATION_RETURNING = `id, org_id AS "orgId",
  grant_application_id AS "grantApplicationId",
  finance_transaction_id AS "financeTransactionId",
  amount_usd::text AS "amountUsd",
  created_by AS "createdBy",
  created_at AS "createdAt",
  updated_at AS "updatedAt"`;

export const INSERT_GRANT_ALLOCATION_SQL = `INSERT INTO grant_finance_allocations
  (org_id, grant_application_id, finance_transaction_id, amount_usd, created_by)
 VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::uuid)
 ON CONFLICT (org_id, grant_application_id, finance_transaction_id)
 DO UPDATE SET amount_usd = EXCLUDED.amount_usd, updated_at = now()
 RETURNING ${GRANT_ALLOCATION_RETURNING}`;

export type GrantAllocationInput = {
  orgId: string;
  grantApplicationId: string;
  financeTransactionId: string;
  amountUsd: number;
};

export type GrantAllocationRow = {
  id: string;
  orgId: string;
  grantApplicationId: string;
  financeTransactionId: string;
  amountUsd: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type ParseGrantAllocationResult =
  | { ok: true; value: GrantAllocationInput }
  | { ok: false; error: string };

function asUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return UUID_RE.test(trimmed) ? trimmed : null;
}

/** Round to cents. Rejects non-finite, zero, and negative amounts. */
export function parseAllocationAmountUsd(value: unknown): number {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    throw new Error("amountUsd must be a finite number of dollars");
  }
  const rounded = Math.round(amount * 100) / 100;
  if (rounded <= 0) {
    throw new Error("amountUsd must be greater than 0");
  }
  return rounded;
}

/**
 * Parse an explicit grant↔transaction allocation. Ignores seasonTotalUsd /
 * copySeason / any season-wide figure — those must never become the amount.
 */
export function parseGrantAllocationInput(body: unknown): ParseGrantAllocationResult {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "orgId, grantApplicationId, financeTransactionId, and amountUsd are required" };
  }
  const row = body as Record<string, unknown>;
  const orgId = asUuid(row.orgId);
  const grantApplicationId = asUuid(row.grantApplicationId);
  const financeTransactionId = asUuid(row.financeTransactionId);
  if (!orgId) return { ok: false, error: "orgId is required" };
  if (!grantApplicationId) return { ok: false, error: "grantApplicationId is required" };
  if (!financeTransactionId) return { ok: false, error: "financeTransactionId is required" };
  if (row.amountUsd == null || row.amountUsd === "") {
    return { ok: false, error: "amountUsd is required" };
  }
  try {
    return {
      ok: true,
      value: {
        orgId,
        grantApplicationId,
        financeTransactionId,
        amountUsd: parseAllocationAmountUsd(row.amountUsd),
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "amountUsd must be greater than 0" };
  }
}

function mapAllocationRow(row: {
  id: string;
  orgId: string;
  grantApplicationId: string;
  financeTransactionId: string;
  amountUsd: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}): GrantAllocationRow {
  return {
    id: row.id,
    orgId: row.orgId,
    grantApplicationId: row.grantApplicationId,
    financeTransactionId: row.financeTransactionId,
    amountUsd: Number(row.amountUsd) || 0,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function requireAllocationsTable(client: PoolClient): Promise<void> {
  try {
    const reg = await client.query<{ ok: string | null }>(
      `SELECT to_regclass('public.${GRANT_FINANCE_ALLOCATIONS_TABLE}')::text AS ok`,
    );
    if (!reg.rows[0]?.ok) {
      throw new Error(GRANT_SPEND_SCHEMA_BLOCKER);
    }
  } catch (error) {
    if (error instanceof Error && error.message === GRANT_SPEND_SCHEMA_BLOCKER) throw error;
    throw new Error(GRANT_SPEND_SCHEMA_BLOCKER, { cause: error });
  }
}

/**
 * Persist one explicit allocation. Verifies the grant and the named expense
 * transaction belong to the org, that amountUsd > 0, and that the amount does
 * not exceed the transaction's remaining unallocated dollars. Never sums
 * season-wide finance_transactions.
 */
export async function allocateGrantFinance(
  client: PoolClient,
  input: GrantAllocationInput & { createdBy: string },
): Promise<GrantAllocationRow> {
  const parsed = parseGrantAllocationInput(input);
  if (!parsed.ok) throw new Error(parsed.error);
  const createdBy = asUuid(input.createdBy);
  if (!createdBy) throw new Error("createdBy is required");

  await requireAllocationsTable(client);

  const grant = await client.query(
    `SELECT 1 FROM grant_applications WHERE id = $1::uuid AND org_id = $2::uuid`,
    [parsed.value.grantApplicationId, parsed.value.orgId],
  );
  if (!grant.rowCount) throw new Error("Grant application not found");

  const txn = await client.query<{ type: string; amountUsd: string }>(
    `SELECT type::text AS type, amount_usd::text AS "amountUsd"
       FROM finance_transactions
      WHERE id = $1::uuid AND org_id = $2::uuid`,
    [parsed.value.financeTransactionId, parsed.value.orgId],
  );
  const ledger = txn.rows[0];
  if (!ledger) throw new Error("Finance transaction not found");
  if (ledger.type !== "expense") {
    throw new Error("Only expense transactions can be allocated to a grant");
  }
  const txnAmount = Number(ledger.amountUsd);
  if (!Number.isFinite(txnAmount) || txnAmount <= 0) {
    throw new Error("Finance transaction has no allocatable amount");
  }
  if (parsed.value.amountUsd > txnAmount) {
    throw new Error("Allocation cannot exceed the transaction amount");
  }

  const others = await client.query<{ allocated: string }>(
    `SELECT COALESCE(SUM(amount_usd), 0)::text AS allocated
       FROM grant_finance_allocations
      WHERE org_id = $1::uuid
        AND finance_transaction_id = $2::uuid
        AND grant_application_id <> $3::uuid`,
    [parsed.value.orgId, parsed.value.financeTransactionId, parsed.value.grantApplicationId],
  );
  const alreadyAllocated = Number(others.rows[0]?.allocated ?? 0) || 0;
  const remaining = Math.round((txnAmount - alreadyAllocated) * 100) / 100;
  if (parsed.value.amountUsd > remaining) {
    throw new Error("Allocation would exceed the transaction's remaining unallocated amount");
  }

  const inserted = await client.query<{
    id: string;
    orgId: string;
    grantApplicationId: string;
    financeTransactionId: string;
    amountUsd: string;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
  }>(INSERT_GRANT_ALLOCATION_SQL, [
    parsed.value.orgId,
    parsed.value.grantApplicationId,
    parsed.value.financeTransactionId,
    parsed.value.amountUsd,
    createdBy,
  ]);
  const row = inserted.rows[0];
  if (!row) throw new Error("Grant allocation was not persisted");
  return mapAllocationRow(row);
}

export async function listGrantAllocations(
  client: PoolClient,
  input: { orgId: string; grantApplicationId: string },
): Promise<GrantAllocationRow[]> {
  const orgId = asUuid(input.orgId);
  const grantApplicationId = asUuid(input.grantApplicationId);
  if (!orgId || !grantApplicationId) throw new Error("orgId and grantApplicationId are required");
  await requireAllocationsTable(client);
  const result = await client.query<{
    id: string;
    orgId: string;
    grantApplicationId: string;
    financeTransactionId: string;
    amountUsd: string;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
  }>(
    `SELECT ${GRANT_ALLOCATION_RETURNING}
       FROM grant_finance_allocations
      WHERE org_id = $1::uuid AND grant_application_id = $2::uuid
      ORDER BY created_at DESC`,
    [orgId, grantApplicationId],
  );
  return result.rows.map(mapAllocationRow);
}
