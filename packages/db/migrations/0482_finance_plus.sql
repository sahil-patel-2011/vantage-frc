-- FINANCE, ONE LEVEL DEEPER — member reimbursements on the unified money spine.
--
-- 0461_money_unify.sql made finance_transactions the ONE ledger every money-shaped
-- row lands in, keyed by (org_id, source_kind, source_id). Reimbursements were the
-- one real cash movement with no home: a parent buys a $180 gearbox on their own
-- card, hands the treasurer a phone photo of the receipt, and the money leaves the
-- team's account weeks later with nothing in the system tying the three together.
--
-- This migration adds:
--   * reimbursement_requests — the member-filed claim, its receipt photo (bytea +
--     sha256 following the 0046_partner_revenue_portal.sql sponsor_assets pattern,
--     with a hard size cap), and its draft -> submitted -> approved/denied -> paid
--     lifecycle with approver + decision timestamps.
--   * 'reimbursement' on the 0461 source_kind CHECK list, so the mirror row written
--     when a claim is marked PAID sits on the same spine as orders and receipts.
--
-- MIRROR RLS, per the 0461 per-kind rule ("the ledger can never be edited more
-- loosely than the record it mirrors"): a reimbursement mirror row is written ONLY
-- when an owner/admin marks a claim paid, so it needs NO member mirror policy — the
-- 0035 finance_transactions_admin_write policy (owner/admin AND created_by =
-- current_app_user_id()) is exactly the right permission and already covers the
-- insert, the amount correction, and the delete when a payment is undone. Members
-- deliberately cannot write a 'reimbursement' ledger row: filing a claim is not
-- spending money, and Vantage never records cash that has not moved.

-- ---------------------------------------------------------------- source_kind

ALTER TABLE finance_transactions
  DROP CONSTRAINT IF EXISTS finance_transactions_source_kind_check;

ALTER TABLE finance_transactions
  ADD CONSTRAINT finance_transactions_source_kind_check
  CHECK (source_kind IN (
    'manual',               -- typed straight into the ledger
    'sponsor_contribution', -- mirror of sponsor_contributions (cash)
    'fundraiser',           -- mirror of fundraiser proceeds
    'other',                -- pre-0461 rows recorded with source enum 'other'
    'purchase_request',     -- mirror of a committed /orders purchase_requests row
    'purchase_log',         -- mirror of a finance_purchase_log receipt
    'season_cost',          -- mirror of a paid season_costs row
    'bom',                  -- absorbed BOM estimate (counts_in_balance = false)
    'reimbursement'         -- mirror of a PAID reimbursement_requests row (0482)
  ));

-- ---------------------------------------------------------------- claims

CREATE TABLE reimbursement_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  -- The person who spent their own money. Never derived from the approver.
  member_user_id uuid NOT NULL REFERENCES users(id),
  amount_usd numeric(12,2) NOT NULL CHECK (amount_usd > 0),
  description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 500),
  category_id uuid REFERENCES finance_categories(id) ON DELETE SET NULL,
  purchased_on date,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'approved', 'denied', 'paid')),
  decision_note text CHECK (decision_note IS NULL OR char_length(decision_note) <= 1000),
  approver_user_id uuid REFERENCES users(id),
  submitted_at timestamptz,
  decided_at timestamptz,
  paid_at timestamptz,

  -- Receipt photo, stored inline like sponsor_assets (0046): bytes + byte_size +
  -- sha256 checksum, with a 3 MB cap the API enforces before the INSERT. The
  -- client downscales phone photos first (lib/scouting/media-downscale.ts), so a
  -- 12 MP camera shot lands well under the cap instead of being rejected.
  receipt_filename text CHECK (receipt_filename IS NULL OR char_length(receipt_filename) BETWEEN 1 AND 200),
  receipt_media_type text
    CHECK (receipt_media_type IS NULL OR receipt_media_type IN ('image/jpeg', 'image/png', 'image/webp')),
  receipt_bytes bytea,
  receipt_byte_size integer CHECK (receipt_byte_size IS NULL OR receipt_byte_size BETWEEN 1 AND 3145728),
  receipt_checksum_sha256 text
    CHECK (receipt_checksum_sha256 IS NULL OR receipt_checksum_sha256 ~ '^[0-9a-f]{64}$'),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- A receipt is all-or-nothing: bytes without a checksum (or the reverse) would
  -- let a half-written upload look like a verified receipt.
  CONSTRAINT reimbursement_receipt_complete CHECK (
    (receipt_bytes IS NULL AND receipt_byte_size IS NULL
      AND receipt_checksum_sha256 IS NULL AND receipt_media_type IS NULL)
    OR (receipt_bytes IS NOT NULL AND receipt_byte_size IS NOT NULL
      AND receipt_checksum_sha256 IS NOT NULL AND receipt_media_type IS NOT NULL)
  ),
  -- Decided/paid states must carry their evidence — an "approved" row with no
  -- approver and no timestamp is exactly the kind of unattributable money record
  -- a treasurer handoff cannot survive.
  CONSTRAINT reimbursement_decision_recorded CHECK (
    status IN ('draft', 'submitted')
    OR (approver_user_id IS NOT NULL AND decided_at IS NOT NULL)
  ),
  CONSTRAINT reimbursement_paid_recorded CHECK (status <> 'paid' OR paid_at IS NOT NULL),
  CONSTRAINT reimbursement_submitted_recorded CHECK (status = 'draft' OR submitted_at IS NOT NULL)
);

CREATE INDEX reimbursement_requests_org_status_idx
  ON reimbursement_requests(org_id, status, created_at DESC);
CREATE INDEX reimbursement_requests_org_member_idx
  ON reimbursement_requests(org_id, member_user_id, created_at DESC);
CREATE INDEX reimbursement_requests_org_season_idx
  ON reimbursement_requests(org_id, season_year);

COMMENT ON TABLE reimbursement_requests IS
  'Member out-of-pocket claims. Only a PAID row mirrors into finance_transactions (source_kind=''reimbursement'') — an approved-but-unpaid claim is a promise, not cash out.';
COMMENT ON COLUMN reimbursement_requests.receipt_bytes IS
  'Receipt photo stored inline (0046 pattern). Never SELECT this column outside the receipt-serving route.';

-- ---------------------------------------------------------------- RLS
-- Reimbursements are more sensitive than the rest of the ledger: they name what a
-- specific family paid for out of pocket. Members see and edit their OWN claims;
-- owners/admins see and decide all of them. There is deliberately no org-wide
-- member read policy.

ALTER TABLE reimbursement_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY reimbursement_requests_self_read ON reimbursement_requests
  FOR SELECT TO vantage_app
  USING (is_org_member(org_id) AND member_user_id = current_app_user_id());

CREATE POLICY reimbursement_requests_admin_read ON reimbursement_requests
  FOR SELECT TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

-- A member files their own claim and may keep editing it until a decision lands.
CREATE POLICY reimbursement_requests_self_insert ON reimbursement_requests
  FOR INSERT TO vantage_app
  WITH CHECK (
    is_org_member(org_id)
    AND member_user_id = current_app_user_id()
    AND status IN ('draft', 'submitted')
    AND approver_user_id IS NULL
  );

-- A DENIED claim is readable in USING so the member can fix and resubmit it,
-- but WITH CHECK only ever lets them land on draft/submitted with the approver
-- cleared — a member can never write themselves an approval or a payment.
CREATE POLICY reimbursement_requests_self_update ON reimbursement_requests
  FOR UPDATE TO vantage_app
  USING (
    is_org_member(org_id)
    AND member_user_id = current_app_user_id()
    AND status IN ('draft', 'submitted', 'denied')
  )
  WITH CHECK (
    is_org_member(org_id)
    AND member_user_id = current_app_user_id()
    AND status IN ('draft', 'submitted')
    AND approver_user_id IS NULL
  );

CREATE POLICY reimbursement_requests_self_delete ON reimbursement_requests
  FOR DELETE TO vantage_app
  USING (
    is_org_member(org_id)
    AND member_user_id = current_app_user_id()
    AND status IN ('draft', 'submitted', 'denied')
  );

CREATE POLICY reimbursement_requests_admin_write ON reimbursement_requests
  FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON reimbursement_requests TO vantage_app, vantage_worker;

-- ---------------------------------------------------------------- audit trail
-- Every reimbursement state change writes finance_audit_log, and half of those
-- changes are made by the MEMBER (create, edit, submit, withdraw). The 0035
-- policy only lets owners/admins append, so members would silently lose their
-- half of the trail — the half that proves when a claim was actually filed.
-- This narrow policy lets any member append their OWN reimbursement.* entries;
-- every other action string stays owner/admin-only.

CREATE POLICY finance_audit_log_member_reimbursement_insert ON finance_audit_log
  FOR INSERT TO vantage_app
  WITH CHECK (
    is_org_member(org_id)
    AND actor_user_id = current_app_user_id()
    AND action LIKE 'reimbursement.%'
  );
