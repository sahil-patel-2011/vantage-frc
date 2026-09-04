import { describe, expect, it } from "vitest";
import { assignOnboardingTracks, matchSubteamTracks } from "./assign";

describe("matchSubteamTracks", () => {
  it("fuzzy-matches mechanical keywords", () => {
    expect(matchSubteamTracks("Mech / Fabrication")).toContain("mechanical");
  });

  it("matches programming and software names", () => {
    expect(matchSubteamTracks("Software")).toContain("programming");
    expect(matchSubteamTracks("Programming — Java")).toContain("programming");
  });

  it("matches drive team variants", () => {
    expect(matchSubteamTracks("Drive Team")).toEqual(expect.arrayContaining(["drive_team"]));
  });

  it("returns empty for unrelated names", () => {
    expect(matchSubteamTracks("Spirit & Cheering")).toEqual([]);
  });
});

describe("assignOnboardingTracks", () => {
  it("always includes welcome", () => {
    const tracks = assignOnboardingTracks({
      teamRole: null,
      primaryFocus: null,
      subteamNames: [],
    });
    expect(tracks.map((t) => t.trackKey)).toEqual(["welcome"]);
  });

  it("assigns role and focus tracks", () => {
    const keys = assignOnboardingTracks({
      teamRole: "mentor",
      primaryFocus: "competition",
      subteamNames: [],
    }).map((t) => t.trackKey);
    expect(keys).toEqual(["welcome", "role_mentor", "focus_competition"]);
  });

  it("dedupes specialty tracks across multiple subteams", () => {
    const keys = assignOnboardingTracks({
      teamRole: "student",
      primaryFocus: "build",
      subteamNames: ["Mechanical", "Mech Night Crew", "CAD"],
    }).map((t) => t.trackKey);
    expect(keys).toContain("mechanical");
    expect(keys).toContain("cad");
    expect(keys.filter((k) => k === "mechanical")).toHaveLength(1);
  });

  it("maps crew role and role description onto specialty tracks", () => {
    const keys = assignOnboardingTracks({
      teamRole: "student",
      crewRole: "driver",
      roleDescription: "I CAD the intake and scout quals",
      primaryFocus: "competition",
      subteamNames: [],
    }).map((t) => t.trackKey);
    expect(keys).toEqual(
      expect.arrayContaining(["welcome", "role_student", "focus_competition", "drive_team", "cad", "scouting"]),
    );
  });

  it("assigns a track for every crew job on a comma-separated profile", () => {
    const keys = assignOnboardingTracks({
      teamRole: "student,parent",
      crewRole: "scout,cad",
      primaryFocus: "competition",
      subteamNames: [],
    }).map((t) => t.trackKey);
    expect(keys).toEqual(expect.arrayContaining(["role_student", "role_parent", "scouting", "cad"]));
  });

  it("maps scouting and business subteams", () => {
    const keys = assignOnboardingTracks({
      teamRole: "student",
      primaryFocus: "leadership",
      subteamNames: ["Stand Scouting", "Business & Sponsors"],
    }).map((t) => t.trackKey);
    expect(keys).toEqual(
      expect.arrayContaining([
        "welcome",
        "role_student",
        "focus_leadership",
        "scouting",
        "business",
      ]),
    );
  });
});
