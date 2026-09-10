-- Whether a person ever CHOSE a theme, as distinct from the column's default.
--
-- profiles.theme_preference is NOT NULL DEFAULT 'light' (0026) and onboarding
-- writes 'light' for anyone who skipped the question, so the column cannot say
-- "no preference". /api/theme reported that default as persisted, and the
-- browser then treated "light" as the account's decision and overwrote a Dark
-- or System choice made on the device — on every load, until the person
-- happened to open Account › Appearance. This column is the missing bit:
-- set by the two places a theme is actually chosen (Account › Appearance and
-- the onboarding preferences step when a value was sent), NULL otherwise.
--
-- Existing rows stay NULL. Someone who once chose Light in the account page
-- keeps light on that device (the device stored it too) and simply is not
-- forced to light on a new device until they choose again — the honest state,
-- since we cannot tell their choice from the default after the fact.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS theme_chosen_at timestamptz;
