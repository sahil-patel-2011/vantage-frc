import { describe, expect, it } from "vitest";
import { buildIndependence, type PlayedMatch } from "./independence-from-matches";

const RATINGS = new Map<string, number>([
  ["frcStrongA", 60],
  ["frcStrongB", 60],
  ["frcWeakA", 5],
  ["frcWeakB", 5],
  ["frcOppA", 30],
  ["frcOppB", 30],
  ["frcOppC", 30],
]);

function match(
  i: number,
  redTeams: string[],
  blueTeams: string[],
  redScore: number,
  blueScore: number,
): PlayedMatch {
  return { matchKey: `2026x_qm${i}`, redTeams, blueTeams, redScore, blueScore };
}

/** Six matches with weak partners, six with strong, for one subject team. */
function seasonFor(subject: string, weakWins: boolean[], strongWins: boolean[]): PlayedMatch[] {
  const out: PlayedMatch[] = [];
  weakWins.forEach((won, i) => {
    out.push(match(i, [subject, "frcWeakA", "frcWeakB"], ["frcOppA", "frcOppB", "frcOppC"], won ? 90 : 10, won ? 10 : 90));
  });
  strongWins.forEach((won, i) => {
    out.push(
      match(100 + i, [subject, "frcStrongA", "frcStrongB"], ["frcOppA", "frcOppB", "frcOppC"], won ? 90 : 10, won ? 10 : 90),
    );
  });
  return out;
}

describe("buildIndependence", () => {
  it("reads the winner from the scores, for both alliances", () => {
    const result = buildIndependence(
      seasonFor("frcSubject", [true, true, true, false], [true, true, true, false]),
      new Map(RATINGS).set("frcSubject", 40),
    );
    const subject = result.get("frcSubject")!;
    expect(subject.matchesCounted).toBe(8);
    // Opponents played every match too and get their own verdict.
    expect(result.get("frcOppA")?.matchesCounted).toBe(8);
  });

  it("marks a team that wins beside weak partners as a carry", () => {
    const result = buildIndependence(
      seasonFor("frcSubject", [true, true, true, false], [true, true, true, true]),
      new Map(RATINGS).set("frcSubject", 40),
    );
    expect(result.get("frcSubject")?.verdict).toBe("carries");
  });

  it("marks a team whose wins track its partners as dependent", () => {
    const result = buildIndependence(
      seasonFor("frcSubject", [false, false, false, false], [true, true, true, true]),
      new Map(RATINGS).set("frcSubject", 40),
    );
    expect(result.get("frcSubject")?.verdict).toBe("needs-partners");
  });

  it("drops ties rather than counting half a win", () => {
    // With a dozen matches a fabricated half-win moves the split more than it should.
    const withTie = [
      ...seasonFor("frcSubject", [true, true, false], [true, true, false]),
      match(900, ["frcSubject", "frcWeakA", "frcWeakB"], ["frcOppA", "frcOppB", "frcOppC"], 50, 50),
    ];
    const result = buildIndependence(withTie, new Map(RATINGS).set("frcSubject", 40));
    expect(result.get("frcSubject")?.matchesCounted).toBe(6);
  });

  it("skips a match where a partner has no rating instead of scoring it zero", () => {
    // Treating an unrated partner as 0 would file a strong alliance in the weak
    // half and invert the verdict.
    const ratings = new Map(RATINGS).set("frcSubject", 40);
    ratings.delete("frcStrongB");
    const result = buildIndependence(
      seasonFor("frcSubject", [true, true, true], [true, true, true]),
      ratings,
    );
    expect(result.get("frcSubject")?.matchesCounted).toBe(3);
  });

  it("ignores a match with a missing score", () => {
    const unplayed: PlayedMatch[] = [
      match(1, ["frcSubject", "frcWeakA", "frcWeakB"], ["frcOppA", "frcOppB", "frcOppC"], Number.NaN, 40),
    ];
    const result = buildIndependence(unplayed, new Map(RATINGS).set("frcSubject", 40));
    expect(result.get("frcSubject")).toBeUndefined();
  });

  it("does not treat a team as its own partner", () => {
    const ratings = new Map(RATINGS).set("frcSubject", 999);
    const result = buildIndependence(
      seasonFor("frcSubject", [true, true, true], [true, true, true]),
      ratings,
    );
    // If the subject counted itself, its own 999 would swamp the partner axis
    // and every alliance would land in the same half.
    expect(result.get("frcSubject")?.matchesCounted).toBe(6);
  });

  it("returns nothing at all for an event with no played matches", () => {
    expect(buildIndependence([], RATINGS).size).toBe(0);
  });
});
