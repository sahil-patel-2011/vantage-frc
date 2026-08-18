-- Packing request inbox (Chief Delphi: QR/Google Form "what you want packed").
-- Members submit quickly; only the list creator or an owner/admin promotes a
-- request onto the master packing list. Never stores DEMO items.

CREATE TABLE packing_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  list_id uuid NOT NULL REFERENCES packing_lists(id) ON DELETE CASCADE,
  category text NOT NULL DEFAULT 'Other',
  label text NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0 AND quantity <= 10000),
  note text,
  requested_by uuid NOT NULL REFERENCES users(id),
  requested_name text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'dismissed')),
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  packing_item_id uuid REFERENCES packing_items(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT packing_requests_label_chk CHECK (char_length(trim(label)) BETWEEN 1 AND 200),
  CONSTRAINT packing_requests_name_chk CHECK (char_length(trim(requested_name)) BETWEEN 1 AND 80),
  CONSTRAINT packing_requests_note_chk CHECK (note IS NULL OR char_length(note) <= 400)
);
CREATE INDEX packing_requests_list_pending_idx
  ON packing_requests (list_id, status, created_at)
  WHERE status = 'pending';
CREATE INDEX packing_requests_org_idx ON packing_requests (org_id, created_at DESC);

ALTER TABLE packing_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY packing_requests_member_read ON packing_requests
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY packing_requests_member_insert ON packing_requests
  FOR INSERT TO vantage_app
  WITH CHECK (
    is_org_member(org_id)
    AND requested_by = current_app_user_id()
    AND status = 'pending'
  );
CREATE POLICY packing_requests_self_update ON packing_requests
  FOR UPDATE TO vantage_app
  USING (requested_by = current_app_user_id() AND status = 'pending')
  WITH CHECK (requested_by = current_app_user_id());
CREATE POLICY packing_requests_lead_update ON packing_requests
  FOR UPDATE TO vantage_app
  USING (
    has_org_role(org_id, ARRAY['owner','admin']::org_role[])
    OR EXISTS (
      SELECT 1 FROM packing_lists l
      WHERE l.id = packing_requests.list_id
        AND l.org_id = packing_requests.org_id
        AND l.created_by = current_app_user_id()
    )
  )
  WITH CHECK (
    has_org_role(org_id, ARRAY['owner','admin']::org_role[])
    OR EXISTS (
      SELECT 1 FROM packing_lists l
      WHERE l.id = packing_requests.list_id
        AND l.org_id = packing_requests.org_id
        AND l.created_by = current_app_user_id()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON packing_requests TO vantage_app, vantage_worker;
