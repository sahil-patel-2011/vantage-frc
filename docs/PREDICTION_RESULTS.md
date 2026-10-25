# Match prediction results

*For anyone evaluating match-prediction accuracy. Read the first paragraph before quoting a number. Last updated 2026-10-25.*

**This is not a ±3 claim.** These numbers come from replaying the two events in production's `matches_ref` (2025gagai and 2026gagr, 153 played matches) match by match. Each match is predicted only from what was known walking into it: every robot's event OPR over the matches already played. It is two events, both in Georgia, so treat the numbers as a check on the model, not a promise for every event.

The replay is a test, so it reruns on every change: `packages/prediction-strategy/test/measured-replay.test.ts`, on the public results in `packages/prediction-strategy/test/fixtures/gagai-gagr-played-matches.csv`.

## What changed (2026-10-19)

| | before | after |
| --- | --- | --- |
| Robot with an OPR but no Statbotics EPA | counted at 0.38 × its OPR | counted at its OPR |
| Alliance score | 0.5 × the three robots | the three robots added up (how OPR and EPA are both defined) |
| Robots rated from | Statbotics EPA only | EPA, else this event's OPR from the played quals, plus the team's own scouting |
| Typical error shown | fixed ±4 | 0.43 × the event's average alliance score (`MEASURED_RELATIVE_ERROR`) |
| Win-chance curve | fixed 12 points | 0.3 × the event's average alliance score (`EVENT_WIN_CURVE_SHARE`, `MEASURED_MODEL_SPREAD`) |

## Replay results (141 matches after each event's first six)

| model | matches predicted | score MAE | winner right |
| --- | --- | --- | --- |
| before: 0.5 × 0.38 × OPR, robots with 3+ matches | 115 | 86.3 | 81% |
| event average, no robots | 141 | 56.8 | — |
| OPR summed, robots with 3+ matches | 115 | 36.2 | 81% |
| **OPR summed, every robot that has played (shipped)** | **141** | **39.5** | **79%** |
| same, recent matches weighted up (decay 0.93) | 141 | 38.9 | 75% |

Scaling the sum by 0.9 gave MAE 37.1 and by 0.6 gave 52.3, so the full sum stays. Weighting recent matches up did not pick more winners on these events, so the shipped model leaves it off.

Win chances, 139 decided matches (Brier score: 0.25 is a coin flip, lower is better):

| curve | Brier | log loss |
| --- | --- | --- |
| before: logistic, fixed 12 points | 0.159 | 0.530 |
| logistic, 0.3 × event average (match plan, shipped) | 0.144 | 0.452 |
| score card, old fixed ±4 spread | 0.152 | 0.487 |
| score card, measured spread (Home, shipped) | 0.144 | 0.443 |

## The fixed set behind `FIXTURE_ERROR_BAND`

`fixtureSeasonRows()` is four real alliances (2026gagr quals 57 and 58), each robot rated from the quals before it. `scorePredictionMetrics(fixtureSeasonRows())` gives n **4**, MAE **35.83**, RMSE **44.17**, within ±3 **0.000**, within ±5 **0.250**. `FIXTURE_ERROR_BAND` = **36**, from `errorBandFromMae` (35.83 → 36). It is shown as **typical error ±36 (last measured set)** only when the event's own scoring level is unknown. With the level known, the ± is `errorBandForScoringLevel`, which scales with the game: about ±22 for a 50-point game, ±65 for a 150-point one.

The set it replaced was two made-up matches whose scores were half the robots' ratings. That is how the old 0.5 alliance factor got fitted.

## Method

- Features: Statbotics auto/teleop/endgame EPA where present; this event's OPR (ridge-regularised, from a robot's first played qual, no recency decay); CCWM / DPR when present; the team's scouting (reliability, climb rate, form, match-to-match spread, or a stand-alone rating after three scouted matches).
- Model: calibrated linear blend (`calibrated-linear-v2`). Each robot gets a rating, the alliance scores the sum, minus a small opponent defense term.
- A match with fewer than two rated robots on an alliance is skipped, never filled.
- Fouls an alliance drew from the other side are removed from the score its robots are rated on.

## Seed order at 2026gagr (2026-10-25)

Rank projection used to read only a saved season rating (Statbotics EPA). This event has none in the match file, so every remaining qualification was a coin flip and the projected order was mostly "whoever is ahead now, plus noise." It now rates a robot from the points it has already scored at the event when no season rating is saved, and it widens the win curve to 0.3 × the event's average foul-free alliance score. A robot that has not played is still left unrated.

This is one event (GRITS, 44 teams, 59 qualification matches). It is a check, not a promise for every event. The replay is `packages/prediction-strategy/test/seed-replay.test.ts`.

### Assumptions

- Cut the schedule after qualifications 20, 30, and 40, in the file's play order. Rate robots only from matches before the cut. Play the real remaining qualification schedule in `seedOdds` (10,000 runs).
- A higher score wins. This file has no ties. A win is 3 ranking points and a tie would be 1, which is what the 2026 REBUILT manual says. The file has no fuel or tower breakdown, so the three bonus ranking points (Energized, Supercharged, Traversal) are not awarded. The app still labels that 3-point rule unconfirmed for 2026 and says so on the page.
- "Derived final order" sorts by those win points per match played, then by average foul-free score (official score minus foul points drawn), then by team number. Foul-free average is the tiebreak because it matched the public "Avg Match" column to the hundredth for every team that played eight matches (1261 is 285.75).
- The projected order is each team's median seed from `seedOdds`, which ranks each simulated finish by **total** ranking points (what the page does), not by points per match. Re-ranking those finishes by points per match was slightly worse on this event, so the page was left as it is.
- "Before" is season rating only. The file has none, so every remaining match is a coin flip. "Frozen" keeps the derived order at the cutoff and does not simulate. "Fixed curve" uses the played-match ratings with the old 12-point curve. "After" is what the page now does.

### Check against the public ranking

The public ranking on The Blue Alliance event page for 2026gagr (read 2026-10-25, no API key) includes bonus ranking points. Against the derived win-point order: Spearman **0.974**, the same eight teams in the top eight, **32** of 44 teams on a different rank, mean absolute gap **2** ranks. Two teams (2974 and 1414) appear in nine qualifications in the file; that ranking's points-per-match math counts eight, which fits a surrogate appearance. 1414's extra match is qualification 16. 2974's is qualification 16 or 31 (both are wins with the same foul-free score, so the average cannot tell them apart). The replay does not drop them.

The event page's insights count Energized on 67 of 118 alliance-matches, Supercharged on 2, and Traversal on 0. That is the bonus the file cannot show.

### Results

Spearman rank correlation of the projected order with the derived final order, and how many of the projected top eight are really in the top eight.

| quals played | before (coin flip) | frozen standings | ratings, fixed 12-point curve | after: ratings and event curve |
| --- | --- | --- | --- | --- |
| 20 | 0.722 / 5 | 0.713 / 5 | 0.673 / 5 | **0.736 / 5** |
| 30 | 0.830 / 3 | 0.841 / 3 | 0.860 / 5 | **0.862 / 5** |
| 40 | 0.859 / 5 | 0.859 / 5 | 0.890 / 6 | **0.889 / 6** |

Same projection against the published ranking:

| quals played | before | frozen | fixed 12-point curve | after |
| --- | --- | --- | --- | --- |
| 20 | 0.673 / 5 | 0.669 / 5 | 0.597 / 5 | **0.684 / 5** |
| 30 | 0.797 / 3 | 0.806 / 3 | 0.817 / 5 | **0.816 / 5** |
| 40 | 0.831 / 5 | 0.830 / 5 | 0.850 / 6 | **0.864 / 6** |

The event curve is ahead of both baselines at every cutoff. The fixed 12-point curve is not: after 20 quals it is worse than a coin flip (0.673 vs 0.722 on the derived order, 0.597 vs 0.673 on the published order). By 40 quals the two curves pick almost the same order, because the curve does not change who is favoured, only how sure the chance is. Both curves called the same winners: 27 of 39, 23 of 29, and 15 of 19.

Brier score of those win chances (0.25 is a coin flip, lower is better). The frozen order makes no win chances.

| quals played | coin flip | fixed 12-point curve | event curve |
| --- | --- | --- | --- |
| 20 | 0.250 | 0.257 | **0.218** |
| 30 | 0.250 | 0.189 | **0.167** |
| 40 | 0.250 | 0.171 | **0.141** |

After 20 quals the fixed curve is more confident than a coin flip and less accurate. The event curve is not. Its width at the three cuts was 45.75, 42.57, and 42.12 points (0.3 × the foul-free average so far).

### Not in this change

- **Scouting.** Home already nudges a robot's rating with what this team scouted (form, cycles, climb, defense, breakdowns) and can rate a robot from scouting alone after three scouted matches. Rank projection does not. This replay has no scout sheets, so there is nothing here to measure. A team's own scouting would move close matches; it would not fill a robot nobody has played or scouted.
- **Bonus ranking points.** The page still says they are not predicted. On this event they moved 32 teams by about two ranks on average and did not change which eight teams were captains. Predicting them needs the fuel and tower breakdown, which this file does not have.
