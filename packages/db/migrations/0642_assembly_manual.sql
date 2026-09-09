-- Assembly manual: a LEGO-style, step-by-step build book generated from a team's
-- own Onshape assembly.
--
-- WHY THIS IS A QUEUE AND NOT A REQUEST
--
-- A full FRC robot assembly is hundreds of instances and hundreds of mates, and
-- every step wants its own Onshape shaded view. Onshape rate-limits, renders are
-- slow, and the honest answer is that this job can run for hours. So it is a
-- queued run with a checkpoint: a worker leases it, advances a bounded slice of
-- work, writes `checkpoint` and lets go. A killed relay loses at most the slice
-- it was in the middle of. Nothing here is ever driven from a user request
-- handler.
--
-- WHY THE REPORT COLUMN EXISTS
--
-- The build order is derived TWICE, by two different strategies (mate-dependency
-- topological order, and a geometry-first "biggest structural member first"
-- order), then reconciled and re-validated from an empty assembly. Where the two
-- disagree, the disagreement is recorded rather than hidden, and the count of
-- feasibility checks run / disagreements / unresolved disagreements is shown to
-- the team. A manual that quietly picked one of two possible orders and said
-- nothing would be worse than one that says "these two steps could go either
-- way".
--
-- WHAT IS DELIBERATELY NOT HERE
--
-- No column holds a measurement that did not come out of CAD. Fabrication lines
-- (cut length, drill diameter, tap) are stored with the feature id they were
-- derived from; where the CAD carries no feature for something the line says
-- "confirm — not specified in CAD" instead of guessing a drill size. The model
-- is used only to turn structured facts into an English sentence.

CREATE TABLE assembly_manual_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  started_by uuid NOT NULL REFERENCES users(id),

  -- Where the assembly came from. 'vault' means a cad_documents row whose
  -- external_url is an Onshape link; 'url' means somebody pasted one.
  source_kind text NOT NULL DEFAULT 'url' CHECK (source_kind IN ('vault', 'url')),
  source_document_id uuid REFERENCES cad_documents(id) ON DELETE SET NULL,

  -- The resolved Onshape assembly. Stored explicitly so a run stays reproducible
  -- even if the vault row is edited afterwards.
  onshape_url text NOT NULL,
  document_id text NOT NULL CHECK (btrim(document_id) <> ''),
  workspace_id text NOT NULL CHECK (btrim(workspace_id) <> ''),
  element_id text NOT NULL CHECK (btrim(element_id) <> ''),
  assembly_name text NOT NULL DEFAULT '',

  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'paused', 'completed', 'failed', 'cancelled')),

  -- Stage + cursor. A worker that dies mid-render resumes at the same step
  -- rather than re-fetching the whole assembly from Onshape.
  checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- { stage, stepsDone, stepsTotal, rendersDone, note }
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- { checksRun, disagreements, unresolved, cutList, notes, renderModes }
  report jsonb,

  pdf bytea,
  pdf_byte_size integer CHECK (pdf_byte_size IS NULL OR pdf_byte_size >= 0),

  error text,

  -- Lease: two relays must never advance the same run. A worker claims by
  -- setting lease_owner + lease_expires_at; the heartbeat is updated_at.
  lease_owner text,
  lease_expires_at timestamptz,

  -- Set by the API when a member cancels; the worker checks it between slices
  -- and stops, so a cancel does not have to kill a process.
  cancel_requested_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX assembly_manual_runs_org_idx
  ON assembly_manual_runs (org_id, created_at DESC);

-- The queue index: what a relay polls for.
CREATE INDEX assembly_manual_runs_queue_idx
  ON assembly_manual_runs (status, lease_expires_at NULLS FIRST)
  WHERE status IN ('queued', 'running', 'paused');

-- One org should not be able to flood the queue with identical runs. Not a hard
-- constraint (a re-run after a CAD change is legitimate), just the lookup the
-- API uses to offer "there is already a run in flight for this assembly".
CREATE INDEX assembly_manual_runs_assembly_idx
  ON assembly_manual_runs (org_id, document_id, element_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Steps
-- ---------------------------------------------------------------------------
-- Separate table, not a jsonb array on the run: each step carries a PNG, and a
-- 200-step manual with renders is tens of megabytes. The viewer pages through
-- these; the PDF assembles them once.

CREATE TABLE assembly_manual_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES assembly_manual_runs(id) ON DELETE CASCADE,
  step_number integer NOT NULL CHECK (step_number >= 1),

  -- Sub-assembly this step belongs to (connected component of FASTENED mates),
  -- named by the model from the part names it contains. '' when the step is on
  -- the top-level assembly.
  subassembly text NOT NULL DEFAULT '',

  title text NOT NULL DEFAULT '',
  -- The human sentence. Written by the model FROM the structured facts below,
  -- or by the deterministic writer when no model is available. Never the source
  -- of a measurement.
  sentence text NOT NULL DEFAULT '',
  -- 'model' | 'deterministic' — shown in the run report so a reader knows which
  -- sentences were machine-phrased.
  sentence_source text NOT NULL DEFAULT 'deterministic'
    CHECK (sentence_source IN ('model', 'deterministic')),

  -- [{ instanceId, partId, name, quantity, massKg, bboxMm, cots }]
  parts jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- [{ kind, text, confirmed, featureId, source }] — `confirmed:false` is the
  -- "confirm — not specified in CAD" line.
  fabrication jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- { prerequisites, checks: [{id, passed, detail}], notes }
  feasibility jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Non-null when the two ordering strategies put this step in different places.
  disagreement jsonb,

  render_png bytea,
  -- 'assembly_hidden' | 'assembly_full' | 'part' | 'none'
  render_mode text NOT NULL DEFAULT 'none'
    CHECK (render_mode IN ('assembly_hidden', 'assembly_full', 'part', 'none')),
  -- When render_png IS NULL this says why, verbatim, on the page and in the PDF.
  -- There is no generic cube fallback.
  render_note text NOT NULL DEFAULT '',

  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, step_number)
);

CREATE INDEX assembly_manual_steps_run_idx
  ON assembly_manual_steps (run_id, step_number);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE assembly_manual_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE assembly_manual_steps ENABLE ROW LEVEL SECURITY;

-- Everyone on the team reads the manual — that is the point of it: the manual is
-- for whoever is holding the wrench, not for the CAD lead.
CREATE POLICY assembly_manual_runs_member_read ON assembly_manual_runs
  FOR SELECT TO vantage_app
  USING (is_org_member(org_id));

-- Starting a run spends Onshape API budget and AI credits, so it is a lead's
-- call. started_by must be the caller: an admin cannot attribute a run to
-- somebody else.
CREATE POLICY assembly_manual_runs_lead_insert ON assembly_manual_runs
  FOR INSERT TO vantage_app
  WITH CHECK (
    has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    AND started_by = current_app_user_id()
  );

-- The only update a request path performs is asking for a cancel. Everything
-- else on this row (status transitions, checkpoint, progress, report, pdf) is
-- written by the worker on vantage_worker, which bypasses RLS.
CREATE POLICY assembly_manual_runs_lead_update ON assembly_manual_runs
  FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

CREATE POLICY assembly_manual_runs_lead_delete ON assembly_manual_runs
  FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

CREATE POLICY assembly_manual_steps_member_read ON assembly_manual_steps
  FOR SELECT TO vantage_app
  USING (is_org_member(org_id));

-- No app-role INSERT/UPDATE policy for steps at all: a step is a derived CAD
-- fact and there is no hand-editing path. If somebody needs a different step,
-- they change the CAD and re-run.

GRANT SELECT, INSERT, UPDATE, DELETE ON assembly_manual_runs TO vantage_app, vantage_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON assembly_manual_steps TO vantage_app, vantage_worker;
