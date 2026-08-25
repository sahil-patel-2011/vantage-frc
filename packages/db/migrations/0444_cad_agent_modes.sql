-- Multi-mode CAD agent: the hosted agent session lives in the user's singleton
-- "CAD agent" cad_jobs row (see apps/web/lib/cad/cad-agent-session.ts), so mode
-- state is stored on cad_jobs directly.
--
-- mode           — active agent mode (simple | plan | multitask)
-- proposed_mode  — a pending consent-gated mode-switch proposal
-- proposed_at    — when it was proposed; proposals older than 15s are treated as
--                  declined server-side, so a reload cannot zombie an expired card
-- plan           — plan-mode build plan { brief, steps[], questions[], answers[], approved }
-- tasks          — multitask checklist [{ id, title, status, note }]
--
-- RLS and grants: cad_jobs already has row level security enabled with
-- cad_jobs_member_read / cad_jobs_creator_write policies and table-level grants
-- to vantage_app and vantage_worker (0016_cad_workspace.sql). Column additions
-- inherit those policies and grants; nothing else is required.

ALTER TABLE cad_jobs
  ADD COLUMN mode text NOT NULL DEFAULT 'simple'
    CHECK (mode IN ('simple', 'plan', 'multitask')),
  ADD COLUMN proposed_mode text NULL
    CHECK (proposed_mode IS NULL OR proposed_mode IN ('simple', 'plan', 'multitask')),
  ADD COLUMN proposed_at timestamptz NULL,
  ADD COLUMN plan jsonb NULL,
  ADD COLUMN tasks jsonb NULL;
