/**
 * 90% intervals for the on-screen card.
 *
 * Widths are frozen from the tuning rows of the in-event model the card runs
 * (`SHIPPED_CATEGORY_MODEL`). A category is filled only when holdout coverage
 * landed between 0.85 and 0.95. These numbers do not choose the score model.
 *
 * Fit on the tuning rows, measured once on the holdout (2026-10-26):
 * auto 0.883, teleop 0.882, endgame 0.882, foul 0.911, total 0.883, margin 0.895.
 */
export type FrozenRange = { k: number; nRef: number; z90: number };

export const CARD_RANGE_FITS: {
  auto: FrozenRange | null;
  teleop: FrozenRange | null;
  endgame: FrozenRange | null;
  foul: FrozenRange | null;
  total: FrozenRange | null;
  margin: FrozenRange | null;
} = {
  auto: { k: 1000, nRef: 5, z90: 48.654903559082314 },
  teleop: { k: 8, nRef: 5, z90: 166.2041445272289 },
  endgame: { k: 1000, nRef: 5, z90: 2.365450249530542 },
  foul: { k: 1000, nRef: 5, z90: 16.396703958552685 },
  total: { k: 8, nRef: 5, z90: 184.20202137369012 },
  margin: { k: 1000, nRef: 5, z90: 253.14935056558465 },
};

/**
 * The card may mark a pick high confidence only at this win chance.
 * Holdout matches with max(p, 1-p) ≥ 0.90: 66 matches, 95.5% correct.
 * The ≥ 0.80 tier was 150 matches at 88%, so it is not marked.
 */
export const CARD_HIGH_CONFIDENCE_AT: number | null = 0.9;
