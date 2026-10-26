# Match prediction results

*For anyone evaluating match-prediction accuracy. Read the first paragraph before quoting a number. Last updated 2026-10-26.*

**This is not a ±3 claim, and it is not a 90% winner claim.** The next-match card now uses the prior model, because on the same 570 held-out matches it beat the in-event card on both winner accuracy (0.733 versus 0.715) and Brier (0.162 versus 0.188). Total MAE on those matches is 86.48. Its own win chances still put the expected winner rate near 73%, so a 90% winner claim is not available. Score ranges are split-conformal widths fit on the tuning events only. Their measured holdout coverage is labeled below; an 88.3% range is not called 90%. The AI step is off and unmeasured. The older sections under this one keep the earlier measurements.

### Card coverage on the 570 held-out matches

Widths were chosen on the tuning events only. A left-out tuning event had to be covered at least 90% before the level was accepted. The 570 test matches were not used to set the width. The coverage column is the share of those test residuals that landed inside the range.

| piece | coverage | n | mean width |
| --- | --- | --- | --- |
| auto | 0.935 | 1140 | 106 |
| teleop | 0.910 | 1140 | 345 |
| endgame | 0.954 | 1140 | 12 |
| foul | 0.943 | 1140 | 49 |
| total | 0.906 | 1140 | 371 |
| margin | 0.916 | 570 | 561 |

Picks whose win chance was already at least 0.90, on every held-out match this model scored: 91 of 94 correct (0.968). On the 570 matches the old card could score, that band was 88 of 89. The card prints "91 of 94" and does not print a 90% hit rate. The optional AI note stays off. No model credential was available, so its accuracy, coverage, latency, and cost were not measured.

## Follow-up: earlier events, ranges, and which numbers reach 90%

Fetched 2026-10-26. Same 1,209 matches and the same split as the section below. Tuning was scored before any holdout number from this follow-up was read. The choice rule is unchanged: lower total MAE first (within 0.005), then higher winner accuracy, then lower Brier.

### Earlier-season ratings

FACT. Public event pages at `https://www.thebluealliance.com/event/{key}`, no API key. Statbotics REST was HTTP 500 on 2026-10-26 and was not used. The pages list both alliances and both scoreboard totals. They do not list auto, teleop, or fouls, so a prior is a total only. 876 events ended before 16 October 2026 and had at least 6 parsed matches (31,341 team-event ratings). 102 events had fewer than 6 matches and were left out. 0 downloads failed. The ten events in the category replay are not in this file, so a full-event rating cannot include a match that had not been played yet. Empty keys and failures are stored with the ratings.

FACT. Within a year, the match-weighted robot totals were: 2024 mean 19.1, spread 10.4; 2025 mean 36.0, spread 20.4; 2026 mean 62.1, spread 54.5. A 2024 or 2025 rating is turned into a z-score against that year's robots, then into the current event's points using only matches already played. A 2026 rating stays in points. Weight of a year is `0.45^(2026-year)` on the chosen model. A prior is eligible only when that event's last day is before the study event's first day. During tuning, the five holdout event keys are blocked as well.

INFERENCE. The first match of an event has no category mix yet. The prior is applied to the total only. Auto, teleop, endgame, and fouls stay blank for that match instead of splitting the total into thirds (that split was predicting a tower of about 100 points before anyone had played).

### Fair re-score of the current card

The card's own total leaves fouls out of the rating and compares that number to a scoreboard that includes fouls. Adding the historical foul average to both alliances does not change the margin, the pick, or Brier. It is a fairer total, not a better winner model. The foul-free numbers in the next section stay as they were.

| model | split | matches | total MAE | winners | Brier |
| --- | --- | --- | --- | --- | --- |
| card, fouls left out | tuning | 629 | 92.38 | 0.752 | 0.178 |
| card, foul average added | tuning | 629 | 92.45 | 0.752 | 0.178 |
| card, fouls left out | holdout | 570 | 99.14 | 0.707 | 0.190 |
| card, foul average added | holdout | 570 | 98.37 | 0.707 | 0.190 |

### What was tried, one change at a time

Each row starts from the shipped in-event model and turns one factor on. Total MAE is the tuning number the rule looks at. Holdout is reported after the choice was frozen. It did not pick the winner.

| factor | tuning matches | tuning total MAE | tuning winners | tuning Brier | holdout total MAE | holdout winners | holdout Brier |
| --- | --- | --- | --- | --- | --- | --- | --- |
| shipped, nothing extra | 629 | 89.44 | 0.752 | 0.173 | 94.53 | 0.715 | 0.188 |
| recent matches weighted 0.93 | 629 | 100.76 | 0.716 | 0.198 | 105.86 | 0.679 | 0.215 |
| recent matches weighted 0.85 | 629 | 107.98 | 0.655 | 0.221 | 111.71 | 0.662 | 0.233 |
| extra shrink for a robot with under 3 matches | 629 | 91.25 | 0.750 | 0.180 | 95.86 | 0.715 | 0.196 |
| ignore a zero scoreboard | 629 | 89.44 | 0.752 | 0.173 | 94.53 | 0.715 | 0.188 |
| defense proxy 0.05 | 629 | 89.15 | 0.754 | 0.173 | 94.19 | 0.715 | 0.188 |
| defense proxy 0.10 | 629 | 89.06 | 0.754 | 0.173 | 93.96 | 0.715 | 0.188 |
| synergy 0.5 | 629 | 89.15 | 0.756 | 0.173 | 94.66 | 0.713 | 0.188 |
| synergy 1 | 629 | 89.09 | 0.757 | 0.173 | 95.06 | 0.713 | 0.188 |
| schedule-strength reweight | 629 | 89.23 | 0.757 | 0.173 | 95.04 | 0.711 | 0.188 |
| prior playoff-minus-qual gap | 629 | 89.44 | 0.752 | 0.173 | 94.53 | 0.715 | 0.188 |
| season prior, decay 0.45, 2 matches | 634 | 82.01 | 0.767 | 0.161 | 87.50 | 0.737 | 0.170 |
| season prior, decay 0.45, 6 matches | 634 | 81.21 | 0.772 | 0.160 | 86.80 | 0.737 | 0.167 |
| season prior, decay 0.45, 12 matches | 634 | 81.69 | 0.772 | 0.163 | 87.16 | 0.741 | 0.167 |
| season prior, decay 0.45, 24 matches | 634 | 82.64 | 0.767 | 0.166 | 87.94 | 0.736 | 0.169 |
| season prior, decay 0.70, 2 matches | 634 | 83.29 | 0.769 | 0.162 | 88.25 | 0.741 | 0.171 |
| season prior, decay 0.70, 6 matches | 634 | 83.11 | 0.766 | 0.162 | 87.94 | 0.741 | 0.168 |
| season prior, decay 0.70, 12 matches | 634 | 84.00 | 0.767 | 0.166 | 88.70 | 0.739 | 0.169 |
| season prior, decay 0.70, 24 matches | 634 | 85.32 | 0.755 | 0.170 | 89.65 | 0.737 | 0.172 |
| season prior, decay 1, 2 matches | 634 | 84.61 | 0.769 | 0.163 | 89.17 | 0.744 | 0.172 |
| season prior, decay 1, 6 matches | 634 | 85.23 | 0.758 | 0.165 | 89.57 | 0.744 | 0.170 |
| season prior, decay 1, 12 matches | 634 | 86.77 | 0.759 | 0.169 | 90.85 | 0.730 | 0.172 |
| season prior, decay 1, 24 matches | 634 | 88.63 | 0.755 | 0.174 | 92.30 | 0.720 | 0.175 |

The zero-score row matches the shipped row. One alliance side in the whole file scored 0, and the cached match pages did not contain a red-card, disabled, or no-show line, so that factor had nothing to move. The playoff-gap row also matches the shipped row. Recency and the extra rookie shrink made tuning error worse and were not kept. Defense, synergy, and schedule each helped a little on their own. The season prior helped by about 8 points of total MAE and was the only large gain.

The frozen model starts from the best season prior (decay 0.45, 6 pseudo-matches) and then adds a factor only when the tuning rule says it is better. Defense 0.10 and the schedule reweight both cleared that bar. Synergy on top of that stack did not. Holdout was not used to add or remove them.

### Frozen model

Season prior, decay 0.45, strength 6, defense proxy 0.10, schedule reweight. 634 tuning predictions (the five opening matches can be scored from the prior) and 575 holdout predictions.

| | tuning | holdout |
| --- | --- | --- |
| matches / decided / picks | 634 / 632 / 632 | 575 / 575 / 575 |
| MAE auto | 21.77 | 23.35 |
| MAE teleop | 72.12 | 77.90 |
| MAE endgame | 0.89 | 1.13 |
| MAE foul | 8.73 | 8.27 |
| MAE total | 80.99 | 86.54 |
| RMSE total | 104.00 | 107.31 |
| winners | 0.769 | 0.732 |
| Brier (logistic) | 0.158 | 0.165 |
| log loss | 0.487 | 0.500 |

Tuning by time: early 188 matches, total MAE 88.31, winners 0.747; mid 187, total MAE 78.89, winners 0.797; late 259, total MAE 77.20, winners 0.764.

Holdout early 168 matches, total MAE 90.81, winners 0.768; mid 166 matches, total MAE 83.39, winners 0.717; late 241 matches, total MAE 85.73, winners 0.718.

Season prior alone, without defense or schedule, is holdout total MAE 86.80 and winners 0.737. The two added factors improved tuning MAE from 81.21 to 80.99 and holdout MAE from 86.80 to 86.54, and they lowered the holdout winner rate from 0.737 to 0.732. The rule keeps them because it looks at tuning MAE first. They were not removed after the holdout.

A normal margin, with width 0.30 times the scoreboard mean of matches already played, was chosen on tuning Brier only. It does not change the pick. Holdout Brier moves from 0.165 to 0.163. Log loss 0.494. Calibration of that win chance on the holdout:

| bin | n | predicted | actual |
| --- | --- | --- | --- |
| 0–20% | 92 | 0.105 | 0.087 |
| 20–40% | 109 | 0.296 | 0.257 |
| 40–60% | 130 | 0.495 | 0.531 |
| 60–80% | 144 | 0.701 | 0.701 |
| 80–100% | 100 | 0.904 | 0.940 |

The expected winner rate, the average of the larger of the two win chances, is 0.733 on 575 holdout matches. The model hit 0.732. It is sitting on its own ceiling. A 90% winner rate would require the chances themselves to average 90%, and they do not.

### Earlier in-event ranges

These widths were fit on the in-event model's tuning residuals, then measured once on the holdout. The coverage column is that measurement. 0.883 is 1.7 points under 0.90, so it is not a 90% range.

| piece | holdout sides | coverage | mean width |
| --- | --- | --- | --- |
| auto | 1,140 | 0.883 | 97 |
| teleop | 1,140 | 0.882 | 338 |
| endgame | 1,140 | 0.882 | 5 |
| foul | 1,140 | 0.911 | 33 |
| total | 1,140 | 0.883 | 375 |
| margin | 570 | 0.895 | 506 |

The card no longer uses these widths. The ranges it shows are the split-conformal table at the top, labeled with the coverage measured there. A score cannot be negative, so a low end below zero is shown as 0. Actual scores are never negative, so that does not push a real result out of the interval. A point forecast is not a 90% score. For these older widths, the real total landed inside the range 0.883 of the time.

An earlier quantile fit on the frozen prior model, not the split-conformal widths now on the card: auto 0.881 (width 89), teleop 0.887 (309), endgame 0.867 (3), foul 0.911 (33), total 0.897 (343), margin 0.915 (462). Those are the measured rates.

### Which numbers reach 90%, and which cannot

| metric | where | result | reaches 90%? |
| --- | --- | --- | --- |
| winner, every holdout match | in-event card, before this pass | 0.715 of 523 picks | no |
| winner, every holdout match | frozen model, now on the card | 0.732 of 575 | no |
| expected winner rate from the win chances | frozen model | 0.733 | no — this is the ceiling |
| score inside the total range | in-event card, before this pass | 0.883 of 1,140 sides, mean width 375 | no. 0.883 is 1.7 points under 0.90 |
| score inside the other category ranges | in-event card, before this pass | 0.882 to 0.911 | only foul, at 0.911, is at least 0.90. The others are the measured rates |
| picks whose win chance is at least 80% | in-event card | 0.880 of 150 (132 correct) | no |
| picks whose win chance is at least 90% | in-event card | 0.955 of 66 (63 correct) | yes. The rate is 0.955, not 0.90 |
| picks whose win chance is at least 80% | frozen model | 0.927 of 192 | yes |
| picks whose win chance is at least 90% | frozen model | 0.968 of 94 | yes |

Nothing here is a blanket 90% claim. The older total range covered 0.883. The high-confidence band on that in-event card was right on 63 of 66. The card now marks a pick high confidence only when the win chance is already at least 0.90, and the words it prints are the measured 91 of 94. Those words do not say "90%."

### What the card does, and what the AI step does

The next-match card uses the frozen prior model for a 2026 event whose start date is known. The server reads the public ratings file and keeps a prior only when that earlier event had already ended. A missing start date stays on the in-event card. A season whose categories are not published, including 2027, stays a total only. The ratings file was fetched 2026-10-26 and leaves out the ten study events, so the card's prior for those events is the one the holdout measured. It does not see an event that is missing from the file.

The optional AI step calls whatever chat model the team has already configured. Anthropic Claude Haiku is an example of that configuration, not a model the code selects. The statistical prediction is on the page first. The model call, if it happens, is a later request and does not hold the page. It may only nudge the prediction by a few points. No model credential was available in this environment (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `AI_GATEWAY_API_KEY`, and the other provider keys that were checked were unset), so the step was not run on the holdout. Accuracy, range coverage, latency, and cost per prediction are unmeasured. The step ships off. A dollar cost was not invented. One live call would be one extra completion, and the receipt would carry the provider's cost.

### What this follow-up did not change

The category-model choice in the next section, the foul-free card numbers, and the older two-event replay are the same measurements as before. The home card was not clicked through in a signed-in browser. That needs a team session and a database, and this run did not query production.

## 2026 category backtest (2026-10-26)

### Where the rows came from

FACT. Fetched 2026-10-26 from public The Blue Alliance match pages (`https://www.thebluealliance.com/event/{key}` and `/match/{key}`). No API key was in the environment. Statbotics `https://api.statbotics.io/v3/matches` returned HTTP 500/503 that day, so it was not used. The file is `packages/prediction-strategy/test/fixtures/2026-played-matches.json`.

FACT. GRITS 2026 is TBA event `2026gagr` (Gainesville, 16–17 October 2026, 74 matches). There is no second GRITS key. The 2026 championship divisions and Einstein:

| event | dates | matches |
| --- | --- | --- |
| 2026gagr GRITS | 2026-10-16 – 2026-10-17 | 74 |
| 2026arc Archimedes | 2026-04-29 – 2026-05-02 | 141 |
| 2026cur Curie | 2026-04-29 – 2026-05-02 | 139 |
| 2026dal Daly | 2026-04-29 – 2026-05-02 | 140 |
| 2026gal Galileo | 2026-04-29 – 2026-05-02 | 140 |
| 2026hop Hopper | 2026-04-29 – 2026-05-02 | 140 |
| 2026joh Johnson | 2026-04-29 – 2026-05-02 | 140 |
| 2026mil Milstein | 2026-04-29 – 2026-05-02 | 139 |
| 2026new Newton | 2026-04-29 – 2026-05-02 | 140 |
| 2026cmptx Einstein | 2026-05-02 | 16 |

1,209 matches, 2,418 alliance sides. Identity misses 0: scoreboard = auto + teleop fuel + endgame tower + foul points + adjustments. TBA's "Total Teleop" already includes the tower, so teleop in this file is teleop fuel only. Fuel overlaps auto and teleop and is not added. 104 sides had a nonzero tower. 1 side had a nonzero adjustment (predicted as 0, so it sits inside total error).

INFERENCE. Each event is one field, so the order on the public results page is the play order. Divisions run on the same days and do not see each other. Einstein (phase 1) may use division matches. GRITS (phase 2, October) may use the championship. The championship does not use GRITS. Two playoff matches listed one after another could have overlapped; that would be a small leak and is not corrected here.

### Split, fixed before any accuracy number

Tuning: `2026gagr`, `2026arc`, `2026cur`, `2026dal`, `2026gal` (634 matches). Holdout, scored once after the choice: `2026hop`, `2026joh`, `2026mil`, `2026new`, `2026cmptx` (575 matches). The first match of an event is not scored when the model has no earlier sample, so the tables have 629 tuning predictions and 570 holdout predictions (the coin-flip model can score GRITS match 1 and Einstein match 1 from earlier events' averages: 630 and 571).

Choice rule, tuning only: lowest total MAE (2 decimals, within 0.005 counts as a tie), then higher winner accuracy, then lower Brier. Win-curve width was chosen after the score model, by tuning Brier only. The holdout did not change the model. `relativeError` 0.212 is holdout total MAE 94.53 / mean scoreboard 445.7, and it is only the ± on screen.

### What was compared

- Coin flip: both alliances get the historical category mean, win chance 0.5, no side picked. Expected winner rate is 50%. The accuracy cell stays empty on purpose.
- Current Vantage card: event OPR (ridge 0.5, no decay) summed through `predictAllianceScores`. That number is the foul-free robot total, scored here against the scoreboard (fouls included), which is what the card is compared with. It does not predict categories.
- Plain OPR: same sum with ridge 0.001 and a logistic win curve.
- Component OPR, default: one rating per category, ridge 0.5, no cross-event prior, fouls as their own rating.
- EPA-style: online update per category, prior strength 4, no cross-event prior.
- Tuned component OPR (shipped): decay 1, ridge 2, no cross-event prior, both alliances get the historical foul average, win curve 0.2 × the average scoreboard.
- Tuned EPA: prior strength 2, foul average, no cross-event prior. Tuning total MAE 91.75.
- Ensemble of those two, weight 0.65 on component OPR. Tuning total MAE 89.57, just behind the shipped model (89.44), so it was not shipped. On the holdout its total MAE is 94.58 and its winner rate is 72.3% (Brier 0.191), against the shipped 94.53 / 71.5% / 0.188. The holdout was not used to switch.

Cross-event priors (strength 0, 4, or 10) were in the tuning search. The winner uses 0. Divisions do not see each other anyway. Home therefore rates the event in front of it and does not scan the rest of the season.

### Tuning (the events the choice was allowed to see)

| model | matches | auto MAE | teleop MAE | endgame MAE | foul MAE | total MAE | total RMSE | winners | Brier | log loss |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| coin flip / mean | 630 | 32.35 | 114.16 | 0.94 | 8.89 | 137.50 | 173.34 | — | 0.250 | 0.693 |
| current Vantage card | 629 | — | — | — | — | 92.38 | 117.94 | 75.2% | 0.178 | 0.530 |
| plain OPR | 629 | — | — | — | — | 116.93 | 167.03 | 72.9% | 0.195 | 0.590 |
| component OPR, default | 629 | 23.38 | 83.79 | 1.38 | 10.90 | 92.56 | 118.20 | 75.0% | 0.177 | 0.528 |
| EPA, default | 629 | 22.94 | 81.46 | 0.97 | 9.34 | 92.01 | 118.23 | 74.0% | 0.183 | 0.545 |
| tuned EPA | 629 | 23.11 | 81.84 | 1.12 | 8.73 | 91.75 | 118.16 | 74.4% | 0.181 | 0.537 |
| ensemble | 629 | 22.76 | 80.21 | 1.09 | 8.73 | 89.57 | 115.31 | 74.4% | 0.178 | 0.532 |
| **shipped component OPR** | **629** | **22.81** | **80.10** | **1.09** | **8.73** | **89.44** | **115.06** | **75.2%** | **0.173** | **0.516** |

Shipped, by when in the event (qualifications split in thirds; playoffs count as late):

| cut | matches | total MAE | winners | Brier |
| --- | --- | --- | --- | --- |
| early | 183 | 108.74 | 69.5% | 0.208 |
| mid | 187 | 86.35 | 75.9% | 0.170 |
| late | 259 | 78.04 | 77.6% | 0.152 |

Tuning calibration (predicted red-win chance vs how often red won):

| bin | n | predicted | actual |
| --- | --- | --- | --- |
| 0–20% | 95 | 0.106 | 0.084 |
| 20–40% | 105 | 0.300 | 0.371 |
| 40–60% | 183 | 0.507 | 0.508 |
| 60–80% | 123 | 0.702 | 0.732 |
| 80–100% | 121 | 0.897 | 0.934 |

### Holdout (not used to choose)

| model | matches | auto MAE | teleop MAE | endgame MAE | foul MAE | total MAE | total RMSE | winners | Brier | log loss |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| coin flip / mean | 571 | 30.73 | 102.77 | 1.27 | 8.27 | 121.76 | 151.87 | — | 0.250 | 0.693 |
| current Vantage card | 570 | — | — | — | — | 99.14 | 124.21 | 70.7% | 0.190 | 0.558 |
| plain OPR | 570 | — | — | — | — | 126.71 | 172.54 | 68.6% | 0.211 | 0.635 |
| component OPR, default | 570 | 25.80 | 90.09 | 1.56 | 10.47 | 98.44 | 123.37 | 70.9% | 0.188 | 0.552 |
| EPA, default | 570 | 24.55 | 85.40 | 1.20 | 8.92 | 95.25 | 119.78 | 71.7% | 0.194 | 0.570 |
| tuned EPA | 570 | 24.76 | 87.79 | 1.33 | 8.27 | 96.94 | 121.50 | 70.2% | 0.193 | 0.564 |
| ensemble | 570 | 24.46 | 85.48 | 1.28 | 8.27 | 94.58 | 118.65 | 72.3% | 0.191 | 0.563 |
| **shipped component OPR** | **570** | **24.52** | **85.26** | **1.28** | **8.27** | **94.53** | **118.48** | **71.5%** | **0.188** | **0.552** |

Shipped holdout by cutoff:

| cut | matches | total MAE | winners | Brier |
| --- | --- | --- | --- | --- |
| early | 164 | 110.14 | 75.8% | 0.195 |
| mid | 166 | 88.47 | 69.3% | 0.193 |
| late | 240 | 88.05 | 70.9% | 0.180 |

Holdout calibration:

| bin | n | predicted | actual |
| --- | --- | --- | --- |
| 0–20% | 68 | 0.113 | 0.162 |
| 20–40% | 113 | 0.304 | 0.257 |
| 40–60% | 167 | 0.501 | 0.539 |
| 60–80% | 140 | 0.698 | 0.664 |
| 80–100% | 82 | 0.890 | 0.915 |

Endgame MAE looks small because the tower is usually zero (104 of 2,418 sides scored one). Teleop fuel is most of the miss. Fouls are predicted as the event's average for both alliances, not as a robot skill; that beat rating fouls per robot on the tuning set.

The replay is `packages/prediction-strategy/test/category-backtest.test.ts`. It reruns these numbers, including the tuning search that has to land on the same spec.

### What the screen does

Home's next match uses this model when at least two robots on each alliance have already played and the breakdowns add up. It shows auto, teleop, endgame, the total, a win chance, and a ± from the holdout miss (0.212 × the event's average scoreboard, widened when the robots have played fewer than four matches). The ± is hidden until eight alliance rows exist. Categories are clamped at 0 for display and the total is added back up. 2027 BIOCORE (kickoff 9 January 2027) has no category list until the manual is published, so that season is a total only.

### AI

An org's configured chat model can be asked for a small point delta on top of this forecast. Deltas are clamped (at most 8% of a category or 6 points, whichever is tighter), a reply that looks like a full score is ignored, and the total is recomputed from the pieces. Win chance may move by at most 0.03. The statistical forecast is what remains when the call is off, slow, or fails. The path is off (`PREDICTION_AI_ENABLED` is false, and `VANTAGE_PREDICTION_AI` is not set). It was not measured: there is no credential-free model in this run, so there is no held-out number that says it helps, and no dollar cost to report. One prediction would be one extra completion. Home does not call it.

## Earlier total-only replay (2025gagai and 2026gagr)

**Still not a ±3 claim.** These numbers come from replaying the two events in production's `matches_ref` (2025gagai and 2026gagr, 153 played matches) match by match. Each match is predicted only from what was known walking into it: every robot's event OPR over the matches already played. It is two events, both in Georgia, so treat the numbers as a check on the model, not a promise for every event.

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

The public ranking on The Blue Alliance event page for 2026gagr (read 2026-10-25, no API key) includes bonus ranking points. Against the derived win-point order: Spearman **0.974**, the same eight teams in the top eight, **32** of 44 teams on a different rank, mean absolute gap **2** ranks. Two teams (2974 and 1414) appear in nine qualifications in the file and eight on that ranking. Checked on 2026-10-26: the rows are not duplicates (no repeated alliance or score), and they match the public match list. The public page for qualification 16 marks both 2974 and 1414 as surrogates. Qualification 31 does not. Dropping qualification 16 is the only match that restores 1414's published 4-4 record and 133.12 average. Dropping either qualification 16 or 31 restores 2974's 199.50 average, because both are wins with the same foul-free 271 points; the surrogate label is what picks qualification 16. The file has no surrogate column, so the replay still counts that match. A surrogate match is real; official rankings leave it out for the surrogate teams only.

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

### One rating scale per event (2026-10-26)

A saved season rating and a rating from matches already played are both in points, but they are different estimates. The first version of this page filled a gap with the other and then added them in one alliance. A unit case where one robot's season rating is 500 and everyone else is rated from a 130–50 match flips the predicted winner; rating every robot from the played match does not.

The rule now is: use the season rating only when every robot in the projection has one. Otherwise rate every robot from matches already played, and leave a robot with no played match unrated. This file has no season ratings, so the rule does not change the table above. Re-run on 2026-10-26: the same Spearman, top-8, and Brier numbers.

A failed read of those played-match ratings no longer throws out of the planner. Zero played matches, an empty result, and a thrown read all leave the saved rank on the page and leave remaining matches without a win chance when no season rating covers every robot.

### Not in this change

- **Scouting.** Home already nudges a robot's rating with what this team scouted (form, cycles, climb, defense, breakdowns) and can rate a robot from scouting alone after three scouted matches. Rank projection does not. This replay has no scout sheets, so there is nothing here to measure. A team's own scouting would move close matches; it would not fill a robot nobody has played or scouted.
- **Bonus ranking points.** The page still says they are not predicted. On this event they moved 32 teams by about two ranks on average and did not change which eight teams were captains. Predicting them needs the fuel and tower breakdown, which this file does not have.
