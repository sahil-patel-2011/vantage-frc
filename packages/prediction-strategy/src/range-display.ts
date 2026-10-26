/**
 * Intervals on the next-match card.
 *
 * Widths are split conformal quantiles of the tuning residuals of the card
 * model. The level was raised, on tuning events only, until each left-out
 * tuning event was covered at least 90%. The holdout was not used to pick
 * the width. `CARD_RANGE_COVERAGE` is the coverage then measured on the 570
 * held-out matches. A label has to stay within 1 percentage point of that
 * measurement.
 */
export type FrozenRange = { k: number; nRef: number; z90: number; level?: number };

export const CARD_RANGE_FITS: {
  auto: FrozenRange | null;
  teleop: FrozenRange | null;
  endgame: FrozenRange | null;
  foul: FrozenRange | null;
  total: FrozenRange | null;
  margin: FrozenRange | null;
} = {
  auto: { k: 1000, nRef: 5, z90: 53.25067016770833, level: 0.95 },
  teleop: { k: 8, nRef: 5, z90: 169.50286337896074, level: 0.93 },
  endgame: { k: 1000, nRef: 5, z90: 5.826175406028516, level: 0.96 },
  foul: { k: 4, nRef: 5, z90: 23.317258128416793, level: 0.93 },
  total: { k: 8, nRef: 5, z90: 182.17844118452462, level: 0.92 },
  margin: { k: 1, nRef: 5, z90: 239.56254440105045, level: 0.91 },
};

/** Measured on the 570 held-out matches. These are the labels, not a 90% claim. */
export const CARD_RANGE_COVERAGE: {
  auto: { coverage: number; meanWidth: number; n: number };
  teleop: { coverage: number; meanWidth: number; n: number };
  endgame: { coverage: number; meanWidth: number; n: number };
  foul: { coverage: number; meanWidth: number; n: number };
  total: { coverage: number; meanWidth: number; n: number };
  margin: { coverage: number; meanWidth: number; n: number };
} = {
  auto: { coverage: 0.9350877192982456, meanWidth: 106.48860913676793, n: 1140 },
  teleop: { coverage: 0.9096491228070176, meanWidth: 345.0907608131167, n: 1140 },
  endgame: { coverage: 0.9535087719298245, meanWidth: 11.650957886930895, n: 1140 },
  foul: { coverage: 0.9429824561403509, meanWidth: 48.86321815074068, n: 1140 },
  total: { coverage: 0.906140350877193, meanWidth: 370.89696078797306, n: 1140 },
  margin: { coverage: 0.9157894736842105, meanWidth: 561.329054905571, n: 570 },
};

/**
 * Show the mark when the picked side is already at least this sure.
 * The hit rate is not this threshold. On every held-out match the card model
 * scored, picks this sure were right 91 of 94 times.
 */
export const CARD_HIGH_CONFIDENCE_AT: number | null = 0.9;

export const CARD_HIGH_CONFIDENCE_HITS = { correct: 91, n: 94 };

/** Win-chance curve chosen for the card model on tuning Brier. Share of the scoreboard mean already played. */
export const CARD_MARGIN_SHARE = 0.3;

export function highConfidenceSentence(redWinProbability: number): string {
  if (CARD_HIGH_CONFIDENCE_AT == null) return "";
  const confidence = Math.max(redWinProbability, 1 - redWinProbability);
  if (confidence < CARD_HIGH_CONFIDENCE_AT) return "";
  const { correct, n } = CARD_HIGH_CONFIDENCE_HITS;
  const percent = (Math.round((correct / n) * 1000) / 10).toFixed(1);
  return ` High confidence. ${correct} of ${n} held-out picks this sure were right (${percent}%).`;
}
