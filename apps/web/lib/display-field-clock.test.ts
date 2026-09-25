import { describe, expect, it } from "vitest";
import { fieldAwareClock, queueCue } from "./display";

const at = (hhmm: string) => `2026-09-25T${hhmm}:00.000Z`;
const now = Date.parse(at("15:34"));
const ours = { compLevel: "qm", matchNumber: 33, scheduledTime: at("15:51") };

describe("fieldAwareClock", () => {
  it("counts matches, not minutes, when the field is two or more away", () => {
    // Field on Qual 31, printed for 15:07, so running 27 minutes late.
    const clock = fieldAwareClock(ours, { matchNumber: 31, scheduledTime: at("15:07") }, now);
    expect(clock.before).toBe(2);
    expect(clock.lateMinutes).toBe(27);
    expect(clock.expectedTime).toBe(at("16:18"));
    expect(clock.leavePit).toBe(false);
    expect(queueCue(clock)).toBe("STAY READY");
    expect(clock.fieldLine).toBe("Field on Qual 31 · 2 matches before ours");
  });

  it("tells the pit to move one match out and to queue when ours is next", () => {
    const one = fieldAwareClock(ours, { matchNumber: 32, scheduledTime: at("15:29") }, now);
    expect(one.leavePit).toBe(true);
    const next = fieldAwareClock(ours, { matchNumber: 33, scheduledTime: at("15:51") }, now);
    expect(queueCue(next)).toBe("QUEUE NOW");
    expect(next.fieldLine).toBe("Ours is next on the field");
  });

  it("falls back to the printed time without field data", () => {
    const clock = fieldAwareClock(ours, null, now);
    expect(clock.before).toBeNull();
    expect(clock.expectedTime).toBe(at("15:51"));
    expect(clock.lateMinutes).toBeNull();
  });
});
