# Match prediction results

*For anyone evaluating match-prediction accuracy. Read the first paragraph before quoting a number. Last updated 2026-10-19.*

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
