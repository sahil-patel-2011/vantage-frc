import { describe, expect, it } from "vitest";
import {
  MAX_SEASONS_BACK,
  formProvenance,
  weightedSeasonForm,
} from "../src/season-form";

describe("weightedSeasonForm", () => {
  it("lets this season dominate a blend with its history", () => {
    const form = weightedSeasonForm(
      [
        { year: 2026, rating: 50 },
        { year: 2025, rating: 10 },
        { year: 2024, rating: 10 },
      ],
      2026,
    )!;
    // The old seasons pull it down, but only a little.
    expect(form.rating).toBeGreaterThan(38);
    expect(form.currentSeasonShare).toBeGreaterThan(0.6);
    expect(form.seasonsUsed).toBe(3);
  });

  it("halves the weight every half-life, so old seasons are a whisper", () => {
    const recent = weightedSeasonForm(
      [{ year: 2026, rating: 100 }, { year: 2025, rating: 0 }],
      2026,
    )!;
    const distant = weightedSeasonForm(
      [{ year: 2026, rating: 100 }, { year: 2019, rating: 0 }],
      2026,
    )!;
    // A seven-year-old season should barely move the number.
    expect(distant.rating).toBeGreaterThan(recent.rating);
    expect(distant.rating).toBeGreaterThan(95);
  });

  it("counts a thin season for less than a full one", () => {
    const thin = weightedSeasonForm(
      [{ year: 2026, rating: 0, matches: 1 }, { year: 2025, rating: 100, matches: 12 }],
      2026,
    )!;
    const full = weightedSeasonForm(
      [{ year: 2026, rating: 0, matches: 12 }, { year: 2025, rating: 100, matches: 12 }],
      2026,
    )!;
    // One match this year should not outvote a whole season last year.
    expect(thin.rating).toBeGreaterThan(full.rating);
  });

  it("ignores a season from the future and anything past the window", () => {
    const form = weightedSeasonForm(
      [
        { year: 2026, rating: 40 },
        { year: 2027, rating: 999 },
        { year: 2026 - MAX_SEASONS_BACK - 1, rating: 999 },
      ],
      2026,
    )!;
    expect(form.seasonsUsed).toBe(1);
    expect(form.rating).toBe(40);
  });

  it("returns null rather than inventing a rating", () => {
    expect(weightedSeasonForm([], 2026)).toBeNull();
    expect(weightedSeasonForm([{ year: 2026, rating: Number.NaN }], 2026)).toBeNull();
    expect(weightedSeasonForm([{ year: 2026, rating: 10, matches: 0 }], 2026)).toBeNull();
    expect(weightedSeasonForm([{ year: 2026, rating: 10 }], Number.NaN)).toBeNull();
  });
});

describe("formProvenance", () => {
  it("says how much of the number is this season", () => {
    const mostly = weightedSeasonForm(
      [{ year: 2026, rating: 50 }, { year: 2025, rating: 40 }, { year: 2024, rating: 30 }],
      2026,
    );
    expect(formProvenance(mostly)).toMatch(/this season/i);
  });

  it("flags a number built only from past seasons", () => {
    // No 2026 row: nothing here measures the current robot.
    const historyOnly = weightedSeasonForm([{ year: 2025, rating: 40 }, { year: 2024, rating: 30 }], 2026);
    expect(formProvenance(historyOnly)).toMatch(/no results yet this season/i);
  });

  it("says plainly when there is nothing", () => {
    expect(formProvenance(null)).toMatch(/no season ratings/i);
  });
});
