import { describe, expect, it } from "vitest";
import {
  MIN_MATCHES_FOR_INDEPENDENCE,
  allianceIndependence,
  independenceLabel,
  type TeamMatchRecord,
} from "../src/alliance-independence";

function record(partnerRating: number, won: boolean, i: number): TeamMatchRecord {
  return { matchKey: `qm${i}`, partnerRating, won };
}

/** Six weak-partner matches and six strong, with the win pattern supplied. */
function season(weakWins: boolean[], strongWins: boolean[]): TeamMatchRecord[] {
  return [
    ...weakWins.map((won, i) => record(10, won, i)),
    ...strongWins.map((won, i) => record(60, won, i + 100)),
  ];
}

describe("allianceIndependence", () => {
  it("calls a team that wins with weak partners a carry", () => {
    const result = allianceIndependence(
      season([true, true, true, false], [true, true, true, true]),
    );
    expect(result.verdict).toBe("carries");
    expect(result.winRateWeakPartners).toBeCloseTo(0.75, 3);
    expect(result.summary).toContain("75%");
  });

  it("calls a team whose results track its partners dependent", () => {
    const result = allianceIndependence(
      season([false, false, false, false], [true, true, true, true]),
    );
    expect(result.verdict).toBe("needs-partners");
    expect(result.partnerSwing).toBeCloseTo(1, 3);
    expect(result.summary).toContain("100%");
  });

  it("calls an even split steady rather than forcing a story", () => {
    const result = allianceIndependence(
      season([true, false, true, false], [true, false, true, false]),
    );
    expect(result.verdict).toBe("steady");
    expect(result.partnerSwing).toBeCloseTo(0, 3);
  });

  it("refuses a verdict when there are too few matches", () => {
    const thin = season([true, true], [true]);
    expect(thin.length).toBeLessThan(MIN_MATCHES_FOR_INDEPENDENCE);
    const result = allianceIndependence(thin);
    expect(result.verdict).toBe("unknown");
    // A pick list saying "needs partners" off three matches is worse than one
    // admitting it does not know.
    expect(result.summary).toMatch(/not enough/i);
  });

  it("refuses when every partner was the same strength", () => {
    // No split exists, so there is nothing to compare — the median cut puts
    // everything in one half.
    const flat = Array.from({ length: 10 }, (_, i) => record(30, i % 2 === 0, i));
    expect(allianceIndependence(flat).verdict).toBe("unknown");
  });

  it("refuses when one half is a single match", () => {
    const lopsided = [
      ...Array.from({ length: 9 }, (_, i) => record(50, true, i)),
      record(5, false, 99),
    ];
    expect(allianceIndependence(lopsided).verdict).toBe("unknown");
  });

  it("says so plainly when the team has no scored matches", () => {
    const result = allianceIndependence([]);
    expect(result.verdict).toBe("unknown");
    expect(result.matchesCounted).toBe(0);
    expect(result.summary).toMatch(/no scored matches/i);
  });

  it("drops rows with an unusable partner rating instead of scoring them zero", () => {
    const withJunk: TeamMatchRecord[] = [
      ...season([true, true, false], [true, true, false]),
      { matchKey: "bad1", won: true, partnerRating: Number.NaN },
      { matchKey: "bad2", won: true, partnerRating: -5 },
    ];
    expect(allianceIndependence(withJunk).matchesCounted).toBe(6);
  });
});

describe("independenceLabel", () => {
  it("gives every verdict words, never a colour alone", () => {
    expect(independenceLabel("carries")).toBe("Wins with any alliance");
    expect(independenceLabel("needs-partners")).toBe("Needs a strong partner");
    expect(independenceLabel("steady")).toBe("Steady either way");
    expect(independenceLabel("unknown")).toBe("Not enough matches");
  });
});
