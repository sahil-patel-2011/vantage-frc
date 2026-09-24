-- Every team has a billing row, so a team's own AI key actually turns AI on.
--
-- meteredAI (packages/billing) locks and reads org_billing before every AI call, including
-- calls on the team's own key, and refuses with "Billing account is not configured" when the
-- row is missing. Teams made through the admin console or the create-team path get the row
-- (a free tier with a zero hosted cap); teams made any other way did not, and their owners
-- saved a key and were still told "AI isn't provisioned for this team yet. Ask your Vantage
-- admin" — with no admin step that could fix it from their side.
--
-- The backfilled row is exactly the one new teams get: free tier, zero hosted credit, the
-- current month as the period. It grants no hosted AI; it only lets the team's own key run.

INSERT INTO org_billing (org_id, tier, credit_cap_usd, period_start, period_end)
SELECT o.id, 'free', 0, date_trunc('month', now()), date_trunc('month', now()) + interval '1 month'
  FROM organizations o
 WHERE NOT EXISTS (SELECT 1 FROM org_billing b WHERE b.org_id = o.id)
ON CONFLICT (org_id) DO NOTHING;
