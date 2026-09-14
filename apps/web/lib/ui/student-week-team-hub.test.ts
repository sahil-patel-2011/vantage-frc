import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { attendanceNextActions } from "../attendance/attendance-related";
import { githubNextActions, githubShellCopy } from "../github/github-related";
import { inviteEmptyCopy } from "../invite/invite-flow";
import { hubById, hubFeaturedMoreTabs } from "../nav/hubs";
import { teamAdminNextActions, teamAdminShellCopy } from "../team/team-admin-related";
import { expectPlainCopy } from "./copy-assertions";

const WEB = join(__dirname, "..", "..");

const THIS_SLICE = [
  "lib/team/team-admin-related.ts",
  "app/team/admin/page.tsx",
  "app/team/team-admin-client.tsx",
  "app/team/team-admin-invites.tsx",
  "app/team/team-admin-github.tsx",
  "lib/github/github-related.ts",
  "lib/invite/invite-flow.ts",
  "lib/team/team-invites.ts",
  "lib/attendance/attendance-related.ts",
  "app/roles/roles-client.tsx",
  "lib/roles/compute-roles.ts",
  "lib/nav/hubs.ts",
] as const;

describe("student-week Team hub People / invite / roles slice", () => {
  it("features Invites and Season roles under People", () => {
    const featured = hubFeaturedMoreTabs(hubById("team")).map((tab) => tab.id);
    expect(featured).toContain("team-admin");
    expect(featured).toContain("roles");
    expect(hubById("team").tabs.find((tab) => tab.id === "team-admin")?.label).toBe("Invites");
    expect(hubById("team").tabs.find((tab) => tab.id === "attendance")?.label).toBe("People");
  });

  it("Invites setup is Needs setup with one Choose your team primary", () => {
    expect(teamAdminShellCopy("setup").badge).toBe("Needs setup");
    expectPlainCopy(teamAdminShellCopy("setup").description);
    expectPlainCopy(teamAdminShellCopy("empty").description);
    expect(teamAdminShellCopy("empty").description).toMatch(/waitlist/);
    const setup = teamAdminNextActions({ orgId: null, shell: "setup" });
    expect(setup.map((action) => action.id)).toEqual(["workspace"]);
    expect(setup[0]?.label).toBe("Choose your team");
    const empty = teamAdminNextActions({ orgId: "org-1", shell: "empty", memberCount: 0 });
    expect(empty.map((action) => action.id)).toEqual(["invite"]);
  });

  it("People empty has one roll-call primary; GitHub setup is one Choose your team", () => {
    const empty = attendanceNextActions({
      orgId: "org-1",
      eventCount: 0,
      emptyRollCount: 0,
      canManage: true,
    });
    expect(empty.map((action) => action.id)).toEqual(["first-roll"]);
    expect(githubShellCopy("setup").badge).toBe("Needs setup");
    expectPlainCopy(githubShellCopy("setup").description);
    const githubSetup = githubNextActions({ orgId: null, shell: "setup" });
    expect(githubSetup.map((action) => action.id)).toEqual(["workspace"]);
  });

  it("invite copy names the waitlist and has gold last-snapshot on Invites", () => {
    expect(inviteEmptyCopy("auth_required").description).toMatch(/waitlist/);
    const client = readFileSync(join(WEB, "app/team/team-admin-client.tsx"), "utf8");
    expect(client).toMatch(/putFeatureSnapshot\("team-admin"/);
    expect(client).toMatch(/if \(!view\)/);
    expect(client).toMatch(/AbortSignal\.timeout\(FEATURE_API_TIMEOUT_MS\)/);
    expect(client).toMatch(/clearFeatureSnapshot\("team-admin"/);
    const roles = readFileSync(join(WEB, "app/roles/roles-client.tsx"), "utf8");
    expect(roles).toMatch(/badge="Needs setup"/);
    expect(roles).toMatch(/if \(!view\)/);
  });

  it("does not print leftover Setup required / OAuth / VANTAGE on this slice", () => {
    for (const rel of THIS_SLICE) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/Join or pick a team/);
      expect(src, rel).not.toMatch(/VANTAGE \//);
      expect(src, rel).not.toMatch(/Connect GitHub \(OAuth unavailable\)/);
      expect(src, rel).not.toMatch(/primary-action/);
    }
  });
});
