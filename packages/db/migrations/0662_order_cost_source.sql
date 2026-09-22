-- Whose number is in the budget: a student's guess, or what a mentor entered.
--
-- A purchase request has always carried a cost, and that cost has always come
-- from whoever filed the request. It then mirrors onto the money ledger at
-- approval and the season budget subtracts it. So the budget a team plans
-- against has been built out of students' estimates of what things cost, with
-- nothing anywhere recording that fact.
--
-- The request is the right place for the student to say what they need and
-- link to it. It is the wrong place to fix the price, because they do not know
-- it — shipping, tax, the school's supplier discount and whatever the mentor
-- actually ends up buying are all invisible from a product page.
--
-- So the estimate becomes optional, the mentor can set the real figure when
-- they approve, and this column records which of those the number is. Existing
-- rows keep their exact meaning: every one of them was a requester's estimate,
-- and that is what they are now labelled.

CREATE TYPE order_cost_source AS ENUM ('unpriced', 'requester-estimate', 'mentor-entered');

ALTER TABLE purchase_requests
  ADD COLUMN cost_source order_cost_source NOT NULL DEFAULT 'requester-estimate';

COMMENT ON COLUMN purchase_requests.cost_source IS
  'Where total_cost_usd came from. unpriced means nobody has costed it yet and the zero is a placeholder, not a free part.';

-- A request filed before this column existed always carried a requester's
-- estimate, so the default is already right for every existing row and no
-- backfill is needed. New rows filed without a price set themselves to
-- 'unpriced' explicitly.

CREATE INDEX purchase_requests_unpriced_idx
  ON purchase_requests(org_id, season_year)
  WHERE cost_source = 'unpriced';
