import { describe, expect, it } from "vitest";
import { intelTags, toDisplayMatchIntel } from "./match-intel";

const schedule = { red: ["frc6925", "frc254", "frc1678"], blue: ["frc118", "frc971", "frc2056"] };

describe("pit TV match intel", () => {
  it("says our colour and our own win chance, from the side we are on", () => {
    const intel = toDisplayMatchIntel(
      { matchKey: "2026abc_qm12", prediction: { pRed: 0.62, pBlue: 0.38 }, plan: { alliance: "red", tendencies: [] } },
      "frc6925",
      schedule,
    );
    expect(intel).toMatchObject({ ourColor: "red", ourWinPct: 62, teams: [] });
    const blue = toDisplayMatchIntel({ matchKey: "m", prediction: { pRed: 0.62, pBlue: 0.38 }, plan: null }, "frc118", schedule);
    expect(blue).toMatchObject({ ourColor: "blue", ourWinPct: 38 });
  });

  it("turns engine labels into short words and drops the ones a crew can't use", () => {
    expect(intelTags(["autonomous-leaning", "scout-auto-capable", "pit-noted", "foul-prone", "reliability-risk"])).toEqual([
      "Strong auto",
      "Scores in auto",
      "Draws fouls",
    ]);
    const intel = toDisplayMatchIntel(
      {
        matchKey: "m",
        prediction: null,
        plan: {
          alliance: "blue",
          tendencies: [
            { teamKey: "frc118", labels: ["defense-capable"], evidence: ["n=4"] },
            { teamKey: "frc971", labels: ["pit-noted"], evidence: [] },
          ],
        },
      },
      null,
      null,
    );
    expect(intel?.teams).toEqual([{ teamKey: "frc118", tags: ["Plays defense"] }]);
    expect(intel?.ourWinPct).toBeNull();
  });

  it("returns nothing when there is nothing stored for the match", () => {
    expect(toDisplayMatchIntel(null, "frc6925", schedule)).toBeNull();
  });
});
