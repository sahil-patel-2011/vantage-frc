-- Public form intake: let someone with no Vantage account answer a shared form.
--
-- 0600 gave forms an `audience = 'link'` mode and a share token, but every
-- product route is session-gated by proxy.ts, so the link redirected a
-- prospective student or a parent straight to /signin. A share link that only
-- works for people who already have an account is not a share link.
--
-- This follows the parent-view pattern (0471): the opaque token in the URL is
-- the whole authorization, the route is allow-listed by a narrow regex in
-- proxy.ts, and the database side is two SECURITY DEFINER functions that return
-- the minimum and nothing else. In particular the public reader NEVER returns
-- responses, respondent names, org internals, or anything about a form that is
-- not both `open` and `link`-audience.

-- Read: the questions a respondent needs to see, and nothing more.
CREATE OR REPLACE FUNCTION get_public_form(candidate_token text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
           'id', f.id,
           'title', f.title,
           'description', f.description,
           'purpose', f.purpose,
           'orgName', o.name,
           'teamNumber', o.team_number,
           'questions', COALESCE(
             (SELECT jsonb_agg(
                       jsonb_build_object(
                         'id', q.id,
                         'position', q.position,
                         'kind', q.kind,
                         'label', q.label,
                         'help', q.help,
                         'required', q.required,
                         'config', q.config
                       ) ORDER BY q.position)
                FROM form_questions q
               WHERE q.form_id = f.id),
             '[]'::jsonb)
         )
    FROM forms f
    JOIN organizations o ON o.id = f.org_id
   WHERE f.share_token = candidate_token
     AND f.audience = 'link'
     AND f.status = 'open'
     AND (f.closes_at IS NULL OR f.closes_at > now())
$$;

-- Write: accept one anonymous response, or return NULL.
--
-- Returning NULL rather than raising keeps the caller from having to tell a
-- closed form apart from a bad token, which is also what we want the respondent
-- to see: one honest "this link is not accepting answers" either way.
--
-- Answers arrive as [{questionId, value}] and are matched against the form's
-- own questions, so a caller cannot write an answer to a question belonging to
-- some other team's form. value_number is populated only for genuinely numeric
-- kinds; a non-numeric answer stays NULL rather than becoming 0, because zero
-- is a real rating and "unparseable" is not.
CREATE OR REPLACE FUNCTION submit_public_form_response(
  candidate_token text,
  respondent text,
  answers jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_form forms%ROWTYPE;
  new_response_id uuid;
BEGIN
  SELECT * INTO target_form
    FROM forms
   WHERE share_token = candidate_token
     AND audience = 'link'
     AND status = 'open'
     AND (closes_at IS NULL OR closes_at > now());

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  INSERT INTO form_responses (org_id, form_id, respondent_user_id, respondent_label)
  VALUES (target_form.org_id, target_form.id, NULL, COALESCE(left(btrim(respondent), 120), ''))
  RETURNING id INTO new_response_id;

  INSERT INTO form_answers (org_id, response_id, question_id, value_text, value_number)
  SELECT target_form.org_id,
         new_response_id,
         q.id,
         btrim(a.value),
         CASE
           WHEN q.kind IN ('number', 'scale', 'counter')
            AND btrim(a.value) ~ '^-?[0-9]+(\.[0-9]+)?$'
           THEN btrim(a.value)::numeric
           ELSE NULL
         END
    FROM jsonb_to_recordset(answers) AS a("questionId" uuid, value text)
    JOIN form_questions q
      ON q.id = a."questionId"
     AND q.form_id = target_form.id
   WHERE btrim(COALESCE(a.value, '')) <> '';

  RETURN new_response_id;
END;
$$;

REVOKE ALL ON FUNCTION get_public_form(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION submit_public_form_response(text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_public_form(text) TO vantage_app, vantage_worker;
GRANT EXECUTE ON FUNCTION submit_public_form_response(text, text, jsonb) TO vantage_app, vantage_worker;
