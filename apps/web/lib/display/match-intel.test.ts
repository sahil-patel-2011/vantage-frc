import { describe, expect, it } from "vitest";
import { intelTags, planHeadline, publicMatchIntel, toDisplayMatchIntel } from "./match-intel";

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
      "Draws fouls",
      "Breaks down sometimes",
    ]);
    // The common "can do it" tags only when nothing sets the robot apart, and never teleop.
    expect(intelTags(["scout-auto-capable", "scout-teleop-capable", "scout-endgame-capable"])).toEqual([
      "Scores in auto",
      "Does the endgame",
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
    expect(intel?.teams).toEqual([{ teamKey: "frc118", tags: ["Plays defense"], plan: "may defend" }]);
    expect(intel?.ourWinPct).toBeNull();
  });

  it("returns nothing when there is nothing stored for the match", () => {
    expect(toDisplayMatchIntel(null, "frc6925", schedule)).toBeNull();
  });
});

describe("what a TV link can read", () => {
  it("keeps only win chances and labels, never evidence, entry ids or timestamps", async () => {
    const { publicMatchIntel } = await import("./match-intel");
    const out = publicMatchIntel({
      matchKey: "2026abc_qm12",
      prediction: { pRed: 0.6, pBlue: 0.4, scoredAt: "2026-09-20T10:00:00Z" },
      plan: {
        alliance: "red",
        updatedAt: "2026-09-20T10:00:00Z",
        tendencies: [{ teamKey: "frc118", labels: ["defense-capable"], evidence: ["entries ba297aa2"], scoutEntryIds: ["ba297aa2"] }],
      },
    });
    expect(out).toEqual({
      matchKey: "2026abc_qm12",
      prediction: { pRed: 0.6, pBlue: 0.4 },
      plan: { alliance: "red", tendencies: [{ teamKey: "frc118", labels: ["defense-capable"], evidence: [] }], operations: [], priorities: [] },
    });
    expect(JSON.stringify(out)).not.toMatch(/ba297aa2|scoredAt|updatedAt/);
  });
});

describe("the TV's game plan line", () => {
  it("keeps the instruction and drops the reasoning", () => {
    expect(planHeadline("Defend 118: 118 is 43% of the opposing alliance (+10% win chance)")).toBe("Defend 118");
    expect(planHeadline("Play a clean match: scouting has you at 2 penalty points per match (+1.3% win chance)")).toBe("Play a clean match");
    expect(planHeadline("")).toBeNull();
  });

  it("sends only the short lines to a TV", () => {
    const raw = publicMatchIntel({
      matchKey: "2026gacmp_qm31",
      prediction: null,
      plan: { alliance: "blue", tendencies: [], priorities: ["Defend 118: 118 is 43% of the opposing alliance (+10% win chance)", 7] },
    });
    expect(raw?.plan?.priorities).toEqual(["Defend 118"]);
    expect(toDisplayMatchIntel(raw, "frc6925", null)?.plan).toEqual(["Defend 118"]);
  });
});

describe("a plan line for every robot on the TV", () => {
  it("says what a partner does from its scouted strengths, with no tags needed", () => {
    const intel = toDisplayMatchIntel(
      {
        matchKey: "m",
        prediction: null,
        plan: {
          alliance: "red",
          tendencies: [],
          operations: [{ teamKey: "frc254", teleopCapability: 0.84, endgameCapability: 0.6, defenseLikely: false }],
        },
      },
      "frc6925",
      schedule,
    );
    expect(intel?.teams).toEqual([{ teamKey: "frc254", tags: [], plan: "cycles fast, usually climbs" }]);
  });
});
