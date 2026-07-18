-- Harden purchase-request buy flow so approve → buy link → mark ordered works
-- for the assigned buyer OR the requester when no buyer is set (matches app logic).
-- Never stores card/bank data — only product URL, amounts, and status.

DROP POLICY IF EXISTS purchase_requests_buyer_progress ON purchase_requests;
DROP POLICY IF EXISTS purchase_requests_buyer_item_url ON purchase_requests;

CREATE POLICY purchase_requests_buyer_progress ON purchase_requests FOR UPDATE TO vantage_app
  USING (
    status IN ('approved', 'ordered')
    AND (
      buyer_user_id = current_app_user_id()
      OR (
        buyer_user_id IS NULL
        AND requested_by = current_app_user_id()
      )
    )
  )
  WITH CHECK (
    -- Allow staying on approved/ordered (e.g. attach product URL) or advancing to ordered/received.
    status IN ('approved', 'ordered', 'received')
    AND (
      buyer_user_id = current_app_user_id()
      OR (
        buyer_user_id IS NULL
        AND requested_by = current_app_user_id()
      )
    )
  );

COMMENT ON POLICY purchase_requests_buyer_progress ON purchase_requests IS
  'Buyer (or unassigned requester) may update product URL and mark approved→ordered→received; pay off-platform.';
