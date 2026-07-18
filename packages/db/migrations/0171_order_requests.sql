-- Purchase / ordering requests Soft-UI surface (/orders):
-- assign a buyer after admin approval, and allow peer notifications when a
-- member submits a need or an admin assigns a buyer. Never stores card/bank data —
-- only product URL, amounts, and status (existing purchase_requests columns).

ALTER TABLE purchase_requests
  ADD COLUMN IF NOT EXISTS buyer_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS purchase_requests_org_buyer_idx
  ON purchase_requests(org_id, buyer_user_id)
  WHERE buyer_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS purchase_requests_org_pending_idx
  ON purchase_requests(org_id, created_at DESC)
  WHERE status = 'pending';

-- Assigned buyer may progress approved → ordered → received (app enforces transitions).
DROP POLICY IF EXISTS purchase_requests_buyer_progress ON purchase_requests;
CREATE POLICY purchase_requests_buyer_progress ON purchase_requests FOR UPDATE TO vantage_app
  USING (
    buyer_user_id = current_app_user_id()
    AND status IN ('approved', 'ordered')
  )
  WITH CHECK (
    buyer_user_id = current_app_user_id()
    AND status IN ('ordered', 'received')
  );

-- Peer notify: submitter → admins; admin → requester/buyer.
DROP POLICY IF EXISTS notifications_purchase_request_insert ON notifications;
CREATE POLICY notifications_purchase_request_insert ON notifications FOR INSERT TO vantage_app
  WITH CHECK (
    type IN (
      'purchase_request_submitted',
      'purchase_request_approved',
      'purchase_request_rejected',
      'purchase_request_assigned'
    )
    AND org_id IS NOT NULL
    AND is_org_member(org_id)
    AND EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.org_id = notifications.org_id
        AND m.user_id = notifications.user_id
    )
  );
