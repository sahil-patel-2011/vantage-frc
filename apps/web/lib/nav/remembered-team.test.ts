import { describe, expect, it } from "vitest";
import { chooseMemberTeam, isTeamScopedPage, notOnTeamRedirect, teamPageRedirect } from "./remembered-team";

const TEAM = "6925a000-0000-4000-8000-000000000001";

describe("teamPageRedirect", () => {
  it("fills in the team for a team page that arrived without one", () => {
    const target = teamPageRedirect(new URL("https://vantagefrc.vercel.app/team/admin?tab=members"), TEAM);
    expect(target?.pathname).toBe("/team/admin");
    expect(target?.searchParams.get("orgId")).toBe(TEAM);
    expect(target?.searchParams.get("tab")).toBe("members");
  });

  it("leaves pages alone when a team is already named, the page is not team-scoped, or the id is not a team id", () => {
    expect(teamPageRedirect(new URL(`https://x.test/team/admin?orgId=${TEAM}`), TEAM)).toBeNull();
    expect(teamPageRedirect(new URL("https://x.test/dashboard"), TEAM)).toBeNull();
    expect(teamPageRedirect(new URL("https://x.test/team/admin"), "not-a-uuid")).toBeNull();
    expect(teamPageRedirect(new URL("https://x.test/team/admin"), null)).toBeNull();
  });
});

describe("isTeamScopedPage", () => {
  it("treats every signed-in page as a team page, hub tabs included", () => {
    for (const path of ["/build", "/business", "/calendar", "/tasks", "/robot", "/team", "/scout/pit", "/competition"]) {
      expect(isTeamScopedPage(path)).toBe(true);
    }
    const target = teamPageRedirect(new URL("https://x.test/build?tab=kickoff"), TEAM);
    expect(target?.searchParams.get("orgId")).toBe(TEAM);
    expect(target?.searchParams.get("tab")).toBe("kickoff");
  });

  it("leaves personal pages, platform admin and the steps before a team alone", () => {
    for (const path of ["/", "/dashboard", "/account", "/account/teams", "/admin/teams", "/help/scouting", "/onboarding", "/invite", "/team-setup", "/security", "/settings", "/api/me", "/manifest.webmanifest"]) {
      expect(isTeamScopedPage(path)).toBe(false);
    }
  });
});

describe("chooseMemberTeam", () => {
  const OTHER = "6c6a13e8-8672-4a9c-9be6-960c1298334c";
  it("takes the first candidate the person is on, else their first team", () => {
    expect(chooseMemberTeam([OTHER, TEAM], TEAM)).toBe(TEAM);
    expect(chooseMemberTeam([OTHER], TEAM)).toBe(OTHER);
    expect(chooseMemberTeam([], TEAM)).toBeNull();
    expect(chooseMemberTeam([OTHER], "not-a-uuid", null)).toBe(OTHER);
  });
});

describe("notOnTeamRedirect", () => {
  it("keeps the page and its tab, drops the other team's id", () => {
    const target = notOnTeamRedirect(new URL(`https://x.test/competition?tab=command&orgId=${TEAM}`));
    expect(target.pathname).toBe("/workspace");
    expect(target.searchParams.get("next")).toBe("/competition?tab=command");
    expect(target.searchParams.get("notOnTeam")).toBe("1");
  });

  it("sends the chooser itself to Home", () => {
    expect(notOnTeamRedirect(new URL(`https://x.test/workspace?orgId=${TEAM}`)).searchParams.get("next")).toBe("/dashboard");
  });
});
