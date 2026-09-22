# @vantage/prediction-strategy

Match prediction, alliance ratings, and pick-list maths. Pure functions, no IO,
no database — everything here takes numbers and returns numbers, which is why
it can be unit-tested in this repo's node-only vitest setup.

## What it refuses to do

**It does not decide what a game action is worth.** The points for a fuel cell
are in the game manual and in the team's own value formula, not in a model
file. A season whose manual is not published has no weights to guess at, and
guessing is how you get a confident wrong answer. Callers convert payloads to
points before calling in; `apps/web/lib/scouting/scouted-ratings.ts` is where
that happens.

**It does not invent a number to fill a gap.** When the inputs are not there,
`predictAllianceScores` returns a `skipReason` rather than a score. Every
caller has to handle that, which is the point.

## Predicting a match

```ts
import { predictAllianceScores, isScorePredictionSkip } from "@vantage/prediction-strategy";

const result = predictAllianceScores({ matchKey, red, blue });
if (isScorePredictionSkip(result)) {
  // result.skipReason says what is missing and what would fix it
} else {
  // result.redPredicted / bluePredicted / errorBand / drivers / basis
}
```

`basis` says where the number came from — `"official"`, `"scouting"`, or
`"mixed"` — and the error band widens when it leans on scouting. A screen that
shows the number should show where it came from.

## Ratings from a team's own scouting

This is what makes predictions work at an off-season event, a week-0
scrimmage, or the first morning of week 1 — anywhere Statbotics has no EPA and
nobody has played enough matches for an OPR:

```ts
import { ratingsFromScouting, ratingsByTeam } from "@vantage/prediction-strategy";

const ratings = ratingsByTeam(ratingsFromScouting(rows));
```

Rules it holds to:

- A blank form that was opened and saved is not a robot that scored zero — it
  is a robot nobody watched, and it is left out.
- A robot recorded as **disabled** is a real zero and counts. Breaking down is
  one of the most useful things scouting knows about a robot.
- One row per team per match. Two scouts on the same robot is one observation,
  not two.
- Fewer than three scouted matches cannot carry a prediction on its own
  (`MIN_MATCHES_TO_STAND_ALONE`). With nothing official to blend against, a
  two-match mean would set the number by itself.

## Shrinkage

`shrinkage.ts` pulls every rating toward the field by an amount that depends on
how thin the evidence is, and estimates that amount from the data rather than
taking it as a setting. This is the module that stops the rookie with one lucky
match from leading the event on Friday morning and wrecking every pick list
built that day.

## Layout

| File | What it holds |
| --- | --- |
| `calibrated-score.ts` | The alliance-score regressor and `predictAllianceScores` |
| `scouting-rating.ts` | Per-team ratings from scouted match rows |
| `shrinkage.ts` | Regression toward the field, with the constant estimated |
| `lovat-win.ts` | Win probability from score spreads |
| `zscore-picklist.ts` | Pick-list ordering |
| `win-levers.ts` | Which factors actually move a given match |
| `scout-ops.ts` | Scouting coverage and assignment maths |

Accuracy claims live in [`docs/PREDICTION_RESULTS.md`](../../docs/PREDICTION_RESULTS.md),
measured, not asserted. The ±3 in the code comments is a product goal.
