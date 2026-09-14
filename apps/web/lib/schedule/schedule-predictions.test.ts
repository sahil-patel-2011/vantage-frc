import { describe, expect, it } from "vitest";
import { attachSchedulePredictions, formatSchedulePrediction } from "./schedule-predictions";
import type { ScheduleMatch } from "../schedule-board";

function match(overrides: Partial<ScheduleMatch> = {}): ScheduleMatch {
  return {
    matchKey: "2026casj_qm1",
    compLevel: "qm",
    matchNumber: 1,
    scheduledTime: null,
    red: ["frc1", "frc2", "frc3"],
    blue: ["frc4", "frc5", "frc6"],
    redScore: null,
    blueScore: null,
    winningAlliance: null,
    scoutCount: 0,
    ...overrides,
  };
}

describe("attachSchedulePredictions", () => {
  it("skips scored matches so official scores stay the only numbers", () => {
    const ratings = new Map([
      ["frc1", 40],
      ["frc2", 40],
      ["frc3", 40],
      ["frc4", 20],
      ["frc5", 20],
      ["frc6", 20],
    ]);
    const [row] = attachSchedulePredictions(
      [match({ redScore: 100, blueScore: 80, winningAlliance: "red" })],
      ratings,
      10,
    );
    expect(row?.prediction).toBeNull();
  });

  it("skips an upcoming match when any robot has no rating", () => {
    const ratings = new Map([
      ["frc1", 40],
      ["frc2", 40],
    ]);
    const [row] = attachSchedulePredictions([match()], ratings, 10);
    expect(row?.prediction).toBeNull();
  });

  it("attaches predicted scores and a win % from this event's spread", () => {
    const ratings = new Map([
      ["frc1", 60],
      ["frc2", 60],
      ["frc3", 60],
      ["frc4", 30],
      ["frc5", 30],
      ["frc6", 30],
    ]);
    const [row] = attachSchedulePredictions([match()], ratings, 10);
    expect(row?.prediction?.redPredicted).toBe(180);
    expect(row?.prediction?.bluePredicted).toBe(90);
    expect(row?.prediction?.redWinPct).toBeGreaterThan(0.9);
    expect(formatSchedulePrediction(row!.prediction!)).toMatch(/Est\. 180–90 · \d+% red/);
  });
});
