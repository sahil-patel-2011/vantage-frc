-- ONE MONEY LEDGER — collapse the money data islands onto a single spine.
--
-- Before this migration a team's money lived in FIVE disconnected ledgers:
--   * finance_transactions (0035)        — the ORIGINAL ledger spine: income/expense rows with a
--     source enum, category, occurred_at, plus purchase_request_id / sponsor_contribution_id links.
--     Written by sponsor contributions, fundraisers, partner placements, and order approvals.
--   * finance_purchase_log (0434)        — the Business desk receipt log (vendor, item, amount,
--     payment method, receipt URL). Nothing reconciled it with the ledger.
--   * season_costs (0070)                — the /costs surface's planned/paid season spend rows.
--     Paid rows are real money out; the ledger never saw them.
--   * purchase_requests (0035/0171/0184) — the /orders approval workflow. Approval inserted an
--     expense row keyed only by purchase_request_id; rejections after approval left it stale.
--   * bom_cost_rollup_line_items (0264)  — BOM line-item cost ESTIMATES (qty x unit cost). Money
--     shaped, but planning data: the same dollars usually reappear as an order or a receipt.
--
-- Result: a purchase recorded in /orders did not appear in season costs, and the Business
-- overview could not answer "what did we actually spend".
--
-- This migration makes finance_transactions the ONE spine (the 0454 pick-list pattern):
--   * source_kind text discriminator + source_id uuid identify the row's origin, with a partial
--     UNIQUE index so backfills and app-level mirror upserts are idempotent.
--   * counts_in_balance marks whether a row is a real cash movement. BOM rows are absorbed for
--     visibility but flagged false — counting an estimate next to the order that bought the same
--     part would double count, and Vantage never fabricates money.
--   * Existing rows are classified in place; the other four tables are BACKFILLED in.
--
-- The old tables are DELIBERATELY NOT DROPPED and stay both readable and writable for one
-- release: apps/web/lib/finance/balance.ts reads the unified ledger FIRST and falls back to the
-- legacy tables ONLY for rows not yet mirrored (excluding any (source_kind, source_id) already in
-- the ledger). A follow-up migration can drop finance_purchase_log / season_costs write paths once
-- every consumer records through apps/web/lib/finance/ledger.ts.

-- ---------------------------------------------------------------- spine columns

ALTER TABLE finance_transactions
  ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_id uuid,
  ADD COLUMN IF NOT EXISTS counts_in_balance boolean NOT NULL DEFAULT true;

ALTER TABLE finance_transactions
  ADD CONSTRAINT finance_transactions_source_kind_check
  CHECK (source_kind IN (
    'manual',               -- typed straight into the ledger
    'sponsor_contribution', -- mirror of sponsor_contributions (cash) — income counted from that table
    'fundraiser',           -- mirror of fundraiser proceeds — income counted from fundraiser_events
    'other',                -- pre-0461 rows recorded with source enum 'other'
    'purchase_request',     -- mirror of a committed /orders purchase_requests row
    'purchase_log',         -- mirror of a finance_purchase_log receipt
    'season_cost',          -- mirror of a paid season_costs row
    'bom'                   -- absorbed bom_cost_rollup_line_items estimate (counts_in_balance=false)
  ));

COMMENT ON COLUMN finance_transactions.source_kind IS
  'Which surface produced this row. Paired with source_id it makes mirror writes idempotent.';
COMMENT ON COLUMN finance_transactions.source_id IS
  'Primary key of the mirrored row in its source table (purchase_requests / finance_purchase_log / season_costs / bom_cost_rollup_line_items / sponsor_contributions). NULL for manual entries.';
COMMENT ON COLUMN finance_transactions.counts_in_balance IS
  'False for money-shaped rows that are not cash movements (BOM estimates). Balance math ignores them.';

-- ---------------------------------------------------------------- classify existing rows
-- Writers guarded these links with NOT EXISTS, so one row per link is expected; the ranked update
-- is purely defensive so the unique index below can never fail on legacy duplicates (a duplicate
-- keeps source_id NULL and is left as-is).

WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY org_id, sponsor_contribution_id ORDER BY created_at, id) AS rn
  FROM finance_transactions
  WHERE sponsor_contribution_id IS NOT NULL
)
UPDATE finance_transactions t
SET source_kind = 'sponsor_contribution',
    source_id = CASE WHEN r.rn = 1 THEN t.sponsor_contribution_id END
FROM ranked r
WHERE r.id = t.id;

WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY org_id, purchase_request_id ORDER BY created_at, id) AS rn
  FROM finance_transactions
  WHERE purchase_request_id IS NOT NULL
    AND sponsor_contribution_id IS NULL
)
UPDATE finance_transactions t
SET source_kind = 'purchase_request',
    source_id = CASE WHEN r.rn = 1 THEN t.purchase_request_id END
FROM ranked r
WHERE r.id = t.id;

UPDATE finance_transactions
SET source_kind = 'fundraiser'
WHERE source = 'fundraiser' AND source_kind = 'manual';

UPDATE finance_transactions
SET source_kind = 'other'
WHERE source = 'other' AND source_kind = 'manual';

-- ---------------------------------------------------------------- idempotency spine

CREATE UNIQUE INDEX IF NOT EXISTS finance_transactions_source_uq
  ON finance_transactions(org_id, source_kind, source_id)
  WHERE source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS finance_transactions_org_kind_idx
  ON finance_transactions(org_id, source_kind);

-- ---------------------------------------------------------------- backfill: /orders (purchase_requests)
-- Committed requests (approved and later) are money out. Rows already linked from a legacy
-- approval insert are skipped via both the legacy FK column and the new (source_kind, source_id).

INSERT INTO finance_transactions
  (org_id, season_year, type, source, amount_usd, occurred_at, category_id,
   purchase_request_id, description, created_by, source_kind, source_id, counts_in_balance)
SELECT p.org_id, p.season_year, 'expense', 'purchase_request', p.total_cost_usd,
       COALESCE(p.ordered_at, p.reviewed_at, p.updated_at), p.category_id,
       p.id, 'Order — ' || p.title, COALESCE(p.reviewed_by, p.requested_by),
       'purchase_request', p.id, true
FROM purchase_requests p
WHERE p.status IN ('approved', 'ordered', 'received', 'reimbursed')
  AND p.total_cost_usd > 0
  AND NOT EXISTS (
    SELECT 1 FROM finance_transactions t
    WHERE t.org_id = p.org_id
      AND (t.purchase_request_id = p.id
           OR (t.source_kind = 'purchase_request' AND t.source_id = p.id))
  );

-- ---------------------------------------------------------------- backfill: Business receipts (finance_purchase_log)
-- Receipts linked to a purchase request are already represented by that request's ledger row
-- (same rule apps/web/lib/finance/balance.ts always used), so only unlinked receipts backfill.

INSERT INTO finance_transactions
  (org_id, season_year, type, source, amount_usd, occurred_at, category_id,
   purchase_request_id, description, created_by, source_kind, source_id, counts_in_balance)
SELECT l.org_id, l.season_year, 'expense', 'other', l.amount_usd,
       l.purchased_on::timestamptz, l.category_id,
       NULL, l.vendor || ' — ' || l.item, l.created_by,
       'purchase_log', l.id, true
FROM finance_purchase_log l
WHERE l.amount_usd > 0
  AND l.purchase_request_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM finance_transactions t
    WHERE t.org_id = l.org_id AND t.source_kind = 'purchase_log' AND t.source_id = l.id
  );

-- ---------------------------------------------------------------- backfill: /costs (season_costs)
-- Only PAID rows are cash out (planned rows are a budget, not money spent). season_costs.category
-- is a free-text bucket, not a finance_categories uuid, so the label carries it instead.

INSERT INTO finance_transactions
  (org_id, season_year, type, source, amount_usd, occurred_at, category_id,
   purchase_request_id, description, created_by, source_kind, source_id, counts_in_balance)
SELECT c.org_id, c.season_year, 'expense', 'other', c.amount_usd,
       c.incurred_on::timestamptz, NULL,
       NULL, 'Season cost — ' || c.label || COALESCE(' (' || NULLIF(c.vendor, '') || ')', ''),
       c.created_by, 'season_cost', c.id, true
FROM season_costs c
WHERE c.status = 'paid'
  AND c.amount_usd > 0
  AND NOT EXISTS (
    SELECT 1 FROM finance_transactions t
    WHERE t.org_id = c.org_id AND t.source_kind = 'season_cost' AND t.source_id = c.id
  );

-- ---------------------------------------------------------------- backfill: BOM estimates (bom_cost_rollup_line_items)
-- Absorbed so every money-shaped row lives on one spine, but flagged counts_in_balance = false:
-- a BOM line is an estimate of robot cost and the same dollars typically also exist as an order
-- or a receipt. Counting both would fabricate spend.

INSERT INTO finance_transactions
  (org_id, season_year, type, source, amount_usd, occurred_at, category_id,
   purchase_request_id, description, created_by, source_kind, source_id, counts_in_balance)
SELECT b.org_id, b.season_year, 'expense', 'other', round(b.quantity * b.unit_cost_usd, 2),
       b.created_at, NULL,
       NULL, 'BOM estimate — ' || b.part_name, b.logged_by,
       'bom', b.id, false
FROM bom_cost_rollup_line_items b
WHERE b.quantity * b.unit_cost_usd > 0
  AND NOT EXISTS (
    SELECT 1 FROM finance_transactions t
    WHERE t.org_id = b.org_id AND t.source_kind = 'bom' AND t.source_id = b.id
  );

-- ---------------------------------------------------------------- RLS: member mirror writes
-- 0035 allowed only owners/admins to write finance_transactions. But the surfaces being mirrored
-- (season_costs, finance_purchase_log, bom line items) accept writes from ANY org member, so the
-- mirror row must be writable under the same permission or the member's save would fail. These
-- policies grant members exactly the mirror kinds — direct ledger entries stay admin-only.

CREATE POLICY finance_transactions_member_mirror_insert ON finance_transactions
  FOR INSERT TO vantage_app
  WITH CHECK (
    is_org_member(org_id)
    AND created_by = current_app_user_id()
    AND source_kind IN ('season_cost', 'purchase_log', 'bom')
  );

-- UPDATE/DELETE mirror each source table's own semantics, so the ledger can
-- never be edited more loosely than the record it mirrors:
--   season_cost / bom  — any org member (season_costs has full member CRUD per 0070)
--   purchase_log       — the author only (finance_purchase_log restricts UPDATE
--                        to self per 0434); admins retain their 0035 ALL policy.
CREATE POLICY finance_transactions_member_mirror_update ON finance_transactions
  FOR UPDATE TO vantage_app
  USING (
    is_org_member(org_id)
    AND (
      source_kind IN ('season_cost', 'bom')
      OR (source_kind = 'purchase_log' AND created_by = current_app_user_id())
    )
  )
  WITH CHECK (
    is_org_member(org_id)
    AND (
      source_kind IN ('season_cost', 'bom')
      OR (source_kind = 'purchase_log' AND created_by = current_app_user_id())
    )
  );

CREATE POLICY finance_transactions_member_mirror_delete ON finance_transactions
  FOR DELETE TO vantage_app
  USING (
    is_org_member(org_id)
    AND (
      source_kind IN ('season_cost', 'bom')
      OR (source_kind = 'purchase_log' AND created_by = current_app_user_id())
    )
  );
