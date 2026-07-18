-- Finance-in-AI org opt-in: assistants may read redacted financial summaries only after
-- an admin enables the toggle and accepts a versioned risk acknowledgment.

ALTER TABLE org_ai_policies
  ADD COLUMN IF NOT EXISTS finance_in_ai_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS finance_in_ai_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS finance_in_ai_accepted_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS finance_in_ai_ack_version text;