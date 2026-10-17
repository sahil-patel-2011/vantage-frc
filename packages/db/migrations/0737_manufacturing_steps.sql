-- Shop steps: the ordered list of jobs a part goes through on the shop floor, and
-- the drawing it is made from.
--
-- The Part Manufacturing kanban (0472) says where a part is (CAM, cutting,
-- finishing). It does not say what "cutting" means for this part: fixture the
-- stock, face it, mill the pockets, deburr, tap the holes. Students on the floor
-- need that list, in order, next to the drawing, and the team needs to see which
-- step every part is on without walking over to ask.
--
--   manufacturing_parts.drawing_url  — the drawing the part is cut from (an Onshape
--     drawing, a PDF in the team drive). The part's QR code, printed onto that
--     drawing, opens the part's steps on a phone or at the shop kiosk.
--   manufacturing_steps              — one row per step, ordered by position.
--     status moves todo -> doing -> done. worked_by is the person who did the
--     work (picked at the shared shop kiosk); updated_by is whoever pressed the
--     button. Both are plain credit, never a permission.
--
-- BOUNDARY: steps never replace the kanban state. The app moves the part along
-- the existing state machine when a step starts (ready to cut -> in progress)
-- and when the last step is done (-> done), writing the usual
-- manufacturing_state_events row, so cycle time keeps working off one history.

ALTER TABLE manufacturing_parts
  ADD COLUMN drawing_url text
    CHECK (drawing_url IS NULL OR (drawing_url ~* '^https?://' AND char_length(drawing_url) <= 2000));

COMMENT ON COLUMN manufacturing_parts.drawing_url IS
  'Link to the drawing the part is made from. The part QR (printed on the drawing) opens /manufacturing/part/<id>.';

CREATE TABLE manufacturing_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  part_id uuid NOT NULL REFERENCES manufacturing_parts(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  machine text CHECK (machine IS NULL OR char_length(machine) BETWEEN 1 AND 60),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 2000),
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
  worked_by uuid REFERENCES users(id) ON DELETE SET NULL,
  started_at timestamptz,
  done_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'done' OR done_at IS NOT NULL)
);

CREATE INDEX manufacturing_steps_part_idx ON manufacturing_steps(part_id, position, created_at);
CREATE INDEX manufacturing_steps_open_idx ON manufacturing_steps(org_id, part_id) WHERE status <> 'done';

ALTER TABLE manufacturing_steps ENABLE ROW LEVEL SECURITY;

-- The whole shop works the steps, like the board itself (0472). A step always
-- belongs to a part of the same team.
CREATE POLICY manufacturing_steps_read ON manufacturing_steps FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY manufacturing_steps_insert ON manufacturing_steps FOR INSERT TO vantage_app
  WITH CHECK (
    is_org_member(org_id)
    AND created_by = current_app_user_id()
    AND EXISTS (SELECT 1 FROM manufacturing_parts p WHERE p.id = manufacturing_steps.part_id AND p.org_id = manufacturing_steps.org_id)
  );
CREATE POLICY manufacturing_steps_update ON manufacturing_steps FOR UPDATE TO vantage_app
  USING (is_org_member(org_id))
  WITH CHECK (
    is_org_member(org_id)
    AND EXISTS (SELECT 1 FROM manufacturing_parts p WHERE p.id = manufacturing_steps.part_id AND p.org_id = manufacturing_steps.org_id)
  );
CREATE POLICY manufacturing_steps_delete ON manufacturing_steps FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON manufacturing_steps TO vantage_app, vantage_worker;

-- View only stays read-only (0715).
SELECT install_view_only_guards();
