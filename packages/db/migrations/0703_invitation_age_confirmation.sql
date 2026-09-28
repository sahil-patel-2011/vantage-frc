-- Require positive eligibility when a person joins; retain existing records for review.
-- Existing account access continues to exclude known under-13 birthdays through 0696.
CREATE OR REPLACE FUNCTION enforce_member_age() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE user_id=NEW.user_id AND date_of_birth IS NOT NULL
      AND date_of_birth <= (CURRENT_DATE - interval '13 years')::date
  ) THEN
    RAISE EXCEPTION 'Finish your profile first. Vantage accounts are available to people age 13 and older';
  END IF;
  RETURN NEW;
END $$;
