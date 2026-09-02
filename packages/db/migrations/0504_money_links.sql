-- MONEY LINKS + EVIDENCE LOOPS (0504)
--
-- Part A — one money ledger, closed:
--   * finance_transactions.grant_application_id — an expense can now be TAGGED to the grant
--     that paid for it. Until this column existed the grant report could only show org-wide
--     season spend with a "linkage not configured" disclaimer; now it filters on this column
--     and says "no expenses tagged to this grant yet" until a team tags one.
--   * The same column on the three mirrored SOURCE tables (purchase_requests, season_costs,
--     finance_purchase_log). Every re-mirror through apps/web/lib/finance/ledger.ts reads the
--     source row, so the tag must live on the source or a later re-mirror would drop it.
--   * fundraiser_events.expenses_usd + the 'fundraiser_expense' source_kind — a bake sale's
--     supplies are real money out. The mirror row is keyed (org, 'fundraiser_expense', event id)
--     and always carries the event's running TOTAL, so repeated recordings upsert one row.
--     Proceeds mirror the same way under the existing 'fundraiser' kind (one row per event =
--     total proceeds), replacing the old one-insert-per-deposit rows that had no source_id.
--     Legacy per-deposit rows (source_kind='fundraiser', source_id NULL) are deliberately left
--     in place: balance math already counts fundraiser income from fundraiser_events, never
--     from the ledger, so they cannot double count; deleting history is not this migration's job.
--
-- Part B — evidence loops:
--   * impact_essay_drafts.award_submission_id / award_item_id — an Impact essay draft attached
--     to an award submission becomes an award_items row and remembers where it went, so a
--     second "attach" is a no-op instead of a duplicate essay item.
--   * outreach_calendar_events.impact_activity_id — completing a planned outreach event writes
--     the impact_activities row that substantiates the Impact award and links back to it. The
--     partial UNIQUE makes completion idempotent: one event can only ever log one activity.

-- ---------------------------------------------------------------- grant tagging

ALTER TABLE finance_transactions
  ADD COLUMN IF NOT EXISTS grant_application_id uuid REFERENCES grant_applications(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS finance_transactions_grant_idx
  ON finance_transactions(org_id, grant_application_id)
  WHERE grant_application_id IS NOT NULL;

COMMENT ON COLUMN finance_transactions.grant_application_id IS
  'Grant this expense is attributed to. NULL = not tagged. The grant report sums only tagged expenses.';

ALTER TABLE purchase_requests
  ADD COLUMN IF NOT EXISTS grant_application_id uuid REFERENCES grant_applications(id) ON DELETE SET NULL;
ALTER TABLE season_costs
  ADD COLUMN IF NOT EXISTS grant_application_id uuid REFERENCES grant_applications(id) ON DELETE SET NULL;
ALTER TABLE finance_purchase_log
  ADD COLUMN IF NOT EXISTS grant_application_id uuid REFERENCES grant_applications(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------- fundraiser expenses

ALTER TABLE fundraiser_events
  ADD COLUMN IF NOT EXISTS expenses_usd numeric(12, 2) NOT NULL DEFAULT 0 CHECK (expenses_usd >= 0);

COMMENT ON COLUMN fundraiser_events.expenses_usd IS
  'Running total of money spent running this fundraiser (supplies, fees). Mirrors to finance_transactions as source_kind=fundraiser_expense.';

ALTER TABLE finance_transactions
  DROP CONSTRAINT IF EXISTS finance_transactions_source_kind_check;

ALTER TABLE finance_transactions
  ADD CONSTRAINT finance_transactions_source_kind_check
  CHECK (source_kind IN (
    'manual',               -- typed straight into the ledger
    'sponsor_contribution', -- mirror of sponsor_contributions (cash), one row per contribution
    'fundraiser',           -- mirror of fundraiser proceeds, one row per event = total proceeds
    'fundraiser_expense',   -- mirror of fundraiser_events.expenses_usd, one row per event (0504)
    'other',                -- pre-0461 rows recorded with source enum 'other'
    'purchase_request',     -- mirror of a committed /orders purchase_requests row
    'purchase_log',         -- mirror of a finance_purchase_log receipt
    'season_cost',          -- mirror of a paid season_costs row
    'bom',                  -- absorbed BOM estimate (counts_in_balance = false)
    'reimbursement'         -- mirror of a PAID reimbursement_requests row (0482)
  ));

-- ---------------------------------------------------------------- impact essay -> award item

ALTER TABLE impact_essay_drafts
  ADD COLUMN IF NOT EXISTS award_submission_id uuid REFERENCES award_submissions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS award_item_id uuid REFERENCES award_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS impact_essay_drafts_award_submission_idx
  ON impact_essay_drafts(award_submission_id)
  WHERE award_submission_id IS NOT NULL;

-- ---------------------------------------------------------------- outreach event -> impact activity

ALTER TABLE outreach_calendar_events
  ADD COLUMN IF NOT EXISTS impact_activity_id uuid REFERENCES impact_activities(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS outreach_calendar_events_impact_activity_uq
  ON outreach_calendar_events(impact_activity_id)
  WHERE impact_activity_id IS NOT NULL;
