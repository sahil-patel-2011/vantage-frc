import { describe, expect, it } from "vitest";
import { teamPageRedirect } from "./remembered-team";

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
