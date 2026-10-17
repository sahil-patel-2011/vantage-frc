-- Vendor orders: buy approved requests one vendor at a time, and record what was
-- actually paid.
--
-- An approved purchase request carries the number someone expected it to cost
-- (the requester's estimate, or the mentor's figure from approval — 0662), and
-- approval mirrors that number onto the money ledger (0461). What the team
-- actually pays is different: shipping, tax, a price change, a discount code.
-- Nothing recorded it, so the season budget kept the expected number forever.
--
-- A team also does not buy one request at a time. It fills one cart per vendor
-- (everything from REV in one order, everything from McMaster in another) and
-- pays once. That checkout is the moment the real figure is known.
--
--   vendor_orders                     — one placed order at one vendor: its order
--     number, what the lines cost, shipping and tax, and who placed it when.
--   purchase_requests.vendor_order_id — the placed order a request went out on.
--   purchase_requests.actual_cost_usd — what this request actually cost, its own
--     price plus its share of the order's shipping and tax. NULL until bought.
--
-- At checkout the app writes the actual cost onto each request and upserts the
-- request's existing ledger mirror (source 'purchase_request') with it, in the
-- same transaction, so the budget counts what was paid from the moment the order
-- is placed. total_cost_usd keeps the approved figure, so estimate vs actual stays
-- visible.
--
-- Placing an order is a money write: finance managers only (0714), the same
-- people who approve requests and whose writes the ledger accepts.

CREATE TABLE vendor_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  vendor_id uuid REFERENCES vendors(id) ON DELETE SET NULL,
  vendor_name text NOT NULL CHECK (char_length(vendor_name) BETWEEN 1 AND 200),
  order_number text CHECK (order_number IS NULL OR char_length(order_number) <= 120),
  subtotal_usd numeric(12,2) NOT NULL CHECK (subtotal_usd >= 0),
  shipping_usd numeric(12,2) NOT NULL DEFAULT 0 CHECK (shipping_usd >= 0),
  tax_usd numeric(12,2) NOT NULL DEFAULT 0 CHECK (tax_usd >= 0),
  total_usd numeric(12,2) GENERATED ALWAYS AS (subtotal_usd + shipping_usd + tax_usd) STORED,
  notes text CHECK (notes IS NULL OR char_length(notes) <= 2000),
  placed_by uuid NOT NULL REFERENCES users(id),
  placed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX vendor_orders_org_season_idx ON vendor_orders(org_id, season_year, placed_at DESC);

ALTER TABLE purchase_requests
  ADD COLUMN vendor_order_id uuid REFERENCES vendor_orders(id) ON DELETE SET NULL,
  ADD COLUMN actual_cost_usd numeric(12,2) CHECK (actual_cost_usd IS NULL OR actual_cost_usd >= 0);

CREATE INDEX purchase_requests_vendor_order_idx
  ON purchase_requests(org_id, vendor_order_id)
  WHERE vendor_order_id IS NOT NULL;

COMMENT ON COLUMN purchase_requests.actual_cost_usd IS
  'What this request actually cost (its price plus its share of shipping and tax), set when it was bought. total_cost_usd keeps the approved figure.';

ALTER TABLE vendor_orders ENABLE ROW LEVEL SECURITY;

-- The team sees what was bought and for how much (the same people who see /orders).
-- Placing, correcting and removing an order is a finance manager's write.
CREATE POLICY vendor_orders_read ON vendor_orders FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY vendor_orders_insert ON vendor_orders FOR INSERT TO vantage_app
  WITH CHECK (can_manage_finances(org_id) AND placed_by = current_app_user_id());
CREATE POLICY vendor_orders_update ON vendor_orders FOR UPDATE TO vantage_app
  USING (can_manage_finances(org_id))
  WITH CHECK (can_manage_finances(org_id));
CREATE POLICY vendor_orders_delete ON vendor_orders FOR DELETE TO vantage_app
  USING (can_manage_finances(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON vendor_orders TO vantage_app, vantage_worker;

-- A buyer who is not a finance manager keeps moving their own request along
-- (purchase_requests_buyer_progress, 0171/0184), and members still file requests,
-- but neither may write what it cost or which order it went out on: those feed
-- the budget. A trigger, like 0622, because the rule is about who changes two
-- columns, which the existing permissive UPDATE policies cannot express.
CREATE OR REPLACE FUNCTION purchase_request_actual_cost_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  changed boolean;
BEGIN
  -- No RLS context: the worker role and migrations.
  IF current_app_user_id() IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    changed := NEW.actual_cost_usd IS NOT NULL OR NEW.vendor_order_id IS NOT NULL;
  ELSE
    changed := NEW.actual_cost_usd IS DISTINCT FROM OLD.actual_cost_usd
      OR NEW.vendor_order_id IS DISTINCT FROM OLD.vendor_order_id;
  END IF;
  IF changed AND NOT can_manage_finances(NEW.org_id) THEN
    RAISE EXCEPTION 'Only a finance manager can record what an order actually cost'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- A request only ever goes out on its own team's order.
  IF NEW.vendor_order_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM vendor_orders v WHERE v.id = NEW.vendor_order_id AND v.org_id = NEW.org_id
  ) THEN
    RAISE EXCEPTION 'That vendor order belongs to another team'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION purchase_request_actual_cost_guard() FROM PUBLIC;

CREATE TRIGGER purchase_request_actual_cost_guard_trg
  BEFORE INSERT OR UPDATE OF actual_cost_usd, vendor_order_id ON purchase_requests
  FOR EACH ROW EXECUTE FUNCTION purchase_request_actual_cost_guard();

-- View only stays read-only (0715).
SELECT install_view_only_guards();
