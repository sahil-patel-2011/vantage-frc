-- Commit the enum addition before any following migration uses it.
ALTER TYPE org_capability ADD VALUE IF NOT EXISTS 'manage_scouting';
