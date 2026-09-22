import { describe, expect, it } from "vitest";
import { TRACK_BY_KEY } from "./tracks";

describe("scouting onboarding track", () => {
  it("names the Saturday path and omits Strategy and AI", () => {
    const track = TRACK_BY_KEY.scouting;
    expect(track?.summary).toMatch(/Assign quals/i);
    expect(track?.checks.map((check) => check.key)).toEqual([
      "assign_quals",
      "save_match_pit",
      "conflicts",
      "lock_pick",
    ]);
    expect(track?.checks.map((check) => check.href)).toEqual([
      "/scouting/lineup",
      "/scouting",
      "/scouting?scoutTab=conflicts",
      "/strategy?tab=picks",
    ]);
    const blob = [track?.summary, ...(track?.checks.flatMap((check) => [check.label, check.detail]) ?? [])].join(
      " ",
    );
    expect(blob).not.toMatch(/Strategy and AI/i);
    expect(blob).not.toMatch(/\bAsk AI\b/);
    expect(blob).not.toMatch(/\/chat\b/);
  });
});
