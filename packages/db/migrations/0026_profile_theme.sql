ALTER TABLE profiles
  ADD COLUMN theme_preference text NOT NULL DEFAULT 'light'
  CHECK (theme_preference IN ('light', 'dark'));
