import { describe, expect, it } from "vitest";
import {
  TEAM_LABEL_PLACEHOLDER,
  readRememberedTeamLabel,
  rememberTeamLabel,
  shellOrgLabel,
  type Me,
} from "./app-shell-model";

/*
  A6-11: the top bar read "Your team" (server HTML) → "This team" (URL team known, /api/me not
  back) → "Team 6925" in the first seconds of every page.
*/

const team: Me = { orgId: "org-1", teamNumber: 6925, orgName: "Team 6925" };
const label = (over: Partial<Parameters<typeof shellOrgLabel>[0]>) =>
  shellOrgLabel({ pathname: "/dashboard", orgId: "org-1", me: {}, teamsLoaded: false, remembered: null, ...over });

describe("team label while the page loads", () => {
  it("is the placeholder, never 'This team', until the session answers", () => {
    expect(label({ orgId: "" })).toBe(TEAM_LABEL_PLACEHOLDER);
    expect(label({})).toBe(TEAM_LABEL_PLACEHOLDER);
    expect(label({ me: team, teamsLoaded: true })).toBe("Team 6925");
  });

  it("goes straight to the name this device last showed for the team", () => {
    expect(label({ remembered: "Team 6925" })).toBe("Team 6925");
  });

  it("does not show the previous team over the next team's page while switching", () => {
    expect(label({ orgId: "org-2", me: team, teamsLoaded: true })).toBe("This team");
    expect(label({ orgId: "org-2", me: team, teamsLoaded: true, remembered: "Team 254" })).toBe("Team 254");
  });

  it("keeps the onboarding and no-team wording", () => {
    expect(label({ pathname: "/onboarding", orgId: "" })).toBe("Getting set up");
    expect(label({ orgId: "", teamsLoaded: true })).toBe("No team selected");
  });
});

describe("remembered team labels", () => {
  function memoryStorage() {
    const data = new Map<string, string>();
    return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) };
  }

  it("round-trips per team and keeps only the last eight", () => {
    const storage = memoryStorage();
    rememberTeamLabel(storage, "org-1", "Team 6925");
    expect(readRememberedTeamLabel(storage, "org-1")).toBe("Team 6925");
    expect(readRememberedTeamLabel(storage, "org-2")).toBeNull();
    for (let index = 0; index < 10; index += 1) rememberTeamLabel(storage, `org-x${index}`, `Team ${index}`);
    expect(readRememberedTeamLabel(storage, "org-1")).toBeNull();
    expect(readRememberedTeamLabel(storage, "org-x9")).toBe("Team 9");
  });

  it("survives blocked or corrupt storage", () => {
    expect(readRememberedTeamLabel(null, "org-1")).toBeNull();
    const broken = { getItem: () => "{not json", setItem: () => { throw new Error("full"); } };
    expect(readRememberedTeamLabel(broken, "org-1")).toBeNull();
    expect(() => rememberTeamLabel(broken, "org-1", "Team 1")).not.toThrow();
  });
});
