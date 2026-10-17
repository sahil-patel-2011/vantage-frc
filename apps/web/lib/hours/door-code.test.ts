import { describe, expect, it } from "vitest";
import { DOOR_WINDOW_MS, doorCheckinPath, doorCode, verifyDoorCode } from "./door-code";

const SECRET = "test-secret";
const ORG = "11111111-1111-1111-1111-111111111111";

describe("door check-in code", () => {
  const now = 1_800_000_000_000;

  it("accepts this minute's code and the last minute's, nothing older or newer", () => {
    const code = doorCode(SECRET, ORG, now);
    expect(verifyDoorCode(SECRET, ORG, code.window, code.sig, now)).toBe(true);
    expect(verifyDoorCode(SECRET, ORG, code.window, code.sig, now + DOOR_WINDOW_MS)).toBe(true);
    expect(verifyDoorCode(SECRET, ORG, code.window, code.sig, now + 2 * DOOR_WINDOW_MS)).toBe(false);
    expect(verifyDoorCode(SECRET, ORG, code.window, code.sig, now - DOOR_WINDOW_MS)).toBe(false);
  });

  it("is tied to the team and the server's secret", () => {
    const code = doorCode(SECRET, ORG, now);
    expect(verifyDoorCode(SECRET, "22222222-2222-2222-2222-222222222222", code.window, code.sig, now)).toBe(false);
    expect(verifyDoorCode("other-secret", ORG, code.window, code.sig, now)).toBe(false);
    expect(verifyDoorCode(SECRET, ORG, code.window, "x".repeat(24), now)).toBe(false);
    expect(verifyDoorCode(SECRET, ORG, code.window, "short", now)).toBe(false);
  });

  it("puts the team, minute and signature in the check-in address", () => {
    const code = doorCode(SECRET, ORG, now);
    expect(doorCheckinPath(ORG, code)).toBe(`/hours/checkin?orgId=${ORG}&w=${code.window}&s=${code.sig}`);
  });
});
