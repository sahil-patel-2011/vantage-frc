// ONE PARTS LEDGER — pure, framework-free invariants shared by the store (lib/parts/store.ts),
// the API routes and unit tests. The rule the whole module exists to enforce: a quantity NEVER
// changes without an append-only ledger row, and the quantity column is always the ledger's net.
// No I/O here — store.ts mirrors these semantics in SQL.

/** Movement reasons, matching the inventory_transactions.reason CHECK from 0037. */
export const LEDGER_REASONS = ["received", "used", "adjust", "return", "damaged"] as const;
export type LedgerReason = (typeof LEDGER_REASONS)[number];

/** Ledger sources understood by the unified store (inventory_transactions.source_kind). */
export const LEDGER_SOURCE_KINDS = ["pit_repair_triage", "consumables_backfill"] as const;
export type LedgerSourceKind = (typeof LEDGER_SOURCE_KINDS)[number];

export type LedgerEntry = {
  delta: number;
  reason: LedgerReason;
  note: string;
  /** Event that caused this movement; a (sourceKind, sourceId) pair lands on an item at most once. */
  sourceKind: string | null;
  sourceId: string | null;
};

export type LedgerState = {
  /** Append-only history — adjustments only ever push, never rewrite. */
  entries: LedgerEntry[];
  /** Running total; always equals the net of `entries` (plus any pre-ledger opening balance). */
  quantity: number;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Net movement of a set of ledger entries. */
export function netQuantity(entries: Array<Pick<LedgerEntry, "delta">>): number {
  return round2(entries.reduce((sum, entry) => sum + entry.delta, 0));
}

/**
 * Apply one stock adjustment: appends exactly one ledger row and moves the quantity by the same
 * delta — never a bare quantity write. Returns a NEW state (input untouched).
 * Throws when the movement would take stock below zero, mirroring the SQL guard.
 */
export function applyAdjustment(
  state: LedgerState,
  adjustment: {
    delta: number;
    reason?: LedgerReason;
    note?: string;
    sourceKind?: string | null;
    sourceId?: string | null;
  },
): LedgerState {
  const delta = round2(adjustment.delta);
  if (!Number.isFinite(delta) || delta === 0) {
    throw new Error("Enter a non-zero adjustment");
  }
  const next = round2(state.quantity + delta);
  if (next < 0) {
    throw new Error("Adjustment would drop stock below zero");
  }
  return {
    quantity: next,
    entries: [
      ...state.entries,
      {
        delta,
        reason: adjustment.reason ?? "adjust",
        note: adjustment.note ?? "",
        sourceKind: adjustment.sourceKind ?? null,
        sourceId: adjustment.sourceId ?? null,
      },
    ],
  };
}

/**
 * Consume stock for a source event (e.g. a resolved pit repair), idempotently.
 * - The same (sourceKind, sourceId) applies to an item at most once: replays return the state
 *   unchanged instead of double-decrementing (the SQL twin is the partial UNIQUE from 0462).
 * - The decrement is clamped to what is actually on hand — the ledger records what really left
 *   the shelf, so its net always matches the quantity column. Nothing on hand -> no row at all.
 */
export function applyConsumption(
  state: LedgerState,
  consumption: { quantity: number; sourceKind: string; sourceId: string; note?: string },
): LedgerState {
  const requested = round2(consumption.quantity);
  if (!Number.isFinite(requested) || requested <= 0) {
    throw new Error("Consumed quantity must be greater than zero");
  }
  const alreadyApplied = state.entries.some(
    (entry) => entry.sourceKind === consumption.sourceKind && entry.sourceId === consumption.sourceId,
  );
  if (alreadyApplied) return state;

  const used = Math.min(state.quantity, requested);
  if (used <= 0) return state;

  return applyAdjustment(state, {
    delta: -used,
    reason: "used",
    note: consumption.note ?? "",
    sourceKind: consumption.sourceKind,
    sourceId: consumption.sourceId,
  });
}

/**
 * Which backfill candidates still need to be carried onto the spine. Mirrors the
 * legacy_consumable_id UNIQUE guard in 0462: a legacy row lands at most once, so
 * running the backfill twice yields zero new rows.
 */
export function pendingBackfill<T extends { legacyId: string }>(
  alreadyMigratedLegacyIds: Iterable<string>,
  candidates: T[],
): T[] {
  const migrated = new Set(alreadyMigratedLegacyIds);
  const seen = new Set<string>();
  const pending: T[] = [];
  for (const candidate of candidates) {
    if (migrated.has(candidate.legacyId) || seen.has(candidate.legacyId)) continue;
    seen.add(candidate.legacyId);
    pending.push(candidate);
  }
  return pending;
}

/**
 * Low-stock rule for the unified store: an item flags only when it has a real reorder level.
 * A reorder level of 0 or null means "not tracked" and NEVER flags — even at zero on hand —
 * so teams that don't set thresholds are not spammed with fabricated urgency.
 */
export function isLowStock(quantity: number, reorderLevel: number | null | undefined): boolean {
  if (reorderLevel == null || !Number.isFinite(reorderLevel) || reorderLevel <= 0) return false;
  return quantity <= reorderLevel;
}
