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

describe("subteam tracks link to pages every team has (A2-21)", () => {
  it("never sends a team to another team's lab", () => {
    for (const track of Object.values(TRACK_BY_KEY)) {
      for (const check of track.checks) {
        expect(check.href ?? "", `${track.key}.${check.key}`).not.toMatch(/^\/learn\/6925/);
      }
    }
    expect(TRACK_BY_KEY.programming?.checks.find((check) => check.key === "prog_track")?.href).toBe("/learn/guided/git-first-pr");
    expect(TRACK_BY_KEY.mechanical?.checks.find((check) => check.key === "mech_track")?.href).toBe("/learn/guided#guided-onshape");
  });
});
