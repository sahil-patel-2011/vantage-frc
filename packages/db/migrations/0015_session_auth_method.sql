ALTER TABLE sessions ADD COLUMN auth_method text NOT NULL DEFAULT 'unknown';
CREATE INDEX sessions_user_auth_method_idx ON sessions(user_id,auth_method);
