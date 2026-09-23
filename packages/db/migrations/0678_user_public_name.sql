-- Onboarding writes the person's name onto users.name, and account settings
-- do the same. vantage_app has UPDATE on the table but no UPDATE policy, so
-- Postgres treats the statement as a success that changes zero rows. The
-- profile keeps the name. The public users row stays blank. Scout reports,
-- which may only read users, then show the source word "manual" and no name.
--
-- The app role may change its own name and nothing else. Rows that already
-- have a profile name and a blank public name are filled in here, as the
-- migration role, because those people cannot see one another's profiles.

REVOKE UPDATE ON users FROM vantage_app;
GRANT UPDATE (name) ON users TO vantage_app;

DROP POLICY IF EXISTS users_self_name ON users;
CREATE POLICY users_self_name ON users FOR UPDATE TO vantage_app
  USING (id = current_app_user_id())
  WITH CHECK (id = current_app_user_id());

UPDATE users AS account
SET name = chosen.name
FROM (
  SELECT
    profile.user_id,
    COALESCE(
      NULLIF(btrim(profile.display_name), ''),
      NULLIF(btrim(concat_ws(' ', profile.first_name, profile.last_name)), '')
    ) AS name
  FROM profiles AS profile
) AS chosen
WHERE account.id = chosen.user_id
  AND btrim(COALESCE(account.name, '')) = ''
  AND chosen.name IS NOT NULL;
