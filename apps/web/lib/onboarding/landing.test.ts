import { describe, expect, it } from "vitest";
import { FIRST_FIVE_LIMIT, buildOnboardingLanding, landingTrackRank } from "./landing";

const ORG = "0f6a1e7c-2b4d-4c8e-9a01-3f5b7c9d1e20";

function landing(overrides: Parameters<typeof buildOnboardingLanding>[0]) {
  return buildOnboardingLanding(overrides);
}

describe("role-aware landing", () => {
  it("ranks a crew path above focus, role, and the generic tour", () => {
    expect(landingTrackRank("scouting")).toBeLessThan(landingTrackRank("focus_competition"));
    expect(landingTrackRank("focus_competition")).toBeLessThan(landingTrackRank("role_student"));
    expect(landingTrackRank("role_student")).toBeLessThan(landingTrackRank("welcome"));
  });

  it("lands a scout on scouting links", () => {
    const view = landing({
      teamRole: "student",
      crewRole: "scout",
      primaryFocus: "competition",
      orgId: ORG,
      orgName: "Robo Rangers",
    });
    expect(view.trackKeys[0]).toBe("scouting");
    expect(view.firstFiveMinutes[0]?.href).toContain("/scouting");
    expect(view.summary).toContain("Robo Rangers");
    // The reason caption says which track produced the link.
    expect(view.firstFiveMinutes[0]?.reason).toMatch(/crew role/i);
  });

  it("lands a mentor on team-admin and leadership links, not scouting", () => {
    const view = landing({
      teamRole: "mentor",
      crewRole: null,
      primaryFocus: "leadership",
      orgId: ORG,
      orgName: null,
    });
    expect(view.trackKeys).toContain("role_mentor");
    expect(view.trackKeys).not.toContain("scouting");
    expect(view.headline).toMatch(/team running/i);
    expect(view.secondary?.label).toBe("Team setup checklist");
  });

  it("gives a student the calendar as the secondary action", () => {
    const view = landing({
      teamRole: "student",
      crewRole: "programming",
      primaryFocus: "build",
      orgId: ORG,
      orgName: null,
    });
    expect(view.trackKeys[0]).toBe("programming");
    expect(view.secondary?.label).toBe("Join a subteam calendar");
    expect(view.secondary?.href).toContain("/team/calendar");
  });

  it("always fills exactly five distinct destinations, orgId-tagged", () => {
    const view = landing({
      teamRole: "student",
      crewRole: "cad",
      primaryFocus: "build",
      orgId: ORG,
      orgName: null,
    });
    expect(view.firstFiveMinutes).toHaveLength(FIRST_FIVE_LIMIT);
    const paths = view.firstFiveMinutes.map((link) => link.href.split("?")[0]);
    expect(new Set(paths).size).toBe(FIRST_FIVE_LIMIT);
    expect(view.firstFiveMinutes.every((link) => link.href.includes(`orgId=${ORG}`))).toBe(true);
  });

  it("still produces a usable list from the sparsest possible profile", () => {
    const view = landing({
      teamRole: null,
      crewRole: null,
      primaryFocus: null,
      orgId: ORG,
      orgName: null,
    });
    // Only `welcome` matches, so the org-wide setup path fills the remainder.
    expect(view.trackKeys).toEqual(["welcome"]);
    expect(view.firstFiveMinutes.length).toBe(FIRST_FIVE_LIMIT);
    expect(view.firstFiveMinutes.every((link) => link.href.startsWith("/"))).toBe(true);
  });

  it("does not invent an orgId-scoped destination when there is no workspace", () => {
    const view = landing({
      teamRole: "student",
      crewRole: "scout",
      primaryFocus: "competition",
      orgId: null,
      orgName: null,
    });
    expect(view.primary).toEqual({ href: "/workspace", label: "Choose your team" });
    expect(view.secondary).toBeNull();
    expect(view.firstFiveMinutes.every((link) => !link.href.includes("orgId="))).toBe(true);
  });

  it("sends a platform admin with no workspace to /admin", () => {
    const view = landing({
      teamRole: "other",
      crewRole: null,
      primaryFocus: "leadership",
      orgId: null,
      orgName: null,
      platformAdmin: true,
    });
    expect(view.primary).toEqual({ href: "/admin", label: "Open platform admin" });
  });

  it("reads a free-text role description for a specialty when no crew was picked", () => {
    const view = landing({
      teamRole: "student",
      crewRole: null,
      roleDescription: "I run the pit repair table and help with wiring",
      primaryFocus: "competition",
      orgId: ORG,
      orgName: null,
    });
    expect(view.trackKeys).toContain("mechanical");
    expect(view.trackKeys).toContain("electrical");
  });

  it("falls back to the neutral role when given an unknown one", () => {
    const view = landing({
      teamRole: "sponsor-liaison",
      crewRole: null,
      primaryFocus: "business",
      orgId: ORG,
      orgName: null,
    });
    expect(view.headline).toBe("You're in. Here's where to start.");
    expect(view.eyebrow).toBe("YOU'RE IN");
  });
});
