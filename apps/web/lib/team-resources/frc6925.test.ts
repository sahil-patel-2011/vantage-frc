import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LIVE_SITE_ORIGIN } from "../site";
import { expectPlainCopy } from "../ui/copy-assertions";
import {
  LAB_TRACKS,
  TEAM_6925_RESOURCES,
  TEAM_6925_SETUP_COMMAND,
  TEAM_6925_WEEKS,
  allTeam6925Links,
  resourcesForTrack,
  totalLabMinutes,
  trackMinutes,
  weeksForTrack,
} from "./frc6925";

describe("Team 6925 lab", () => {
  it("is a real lab, not a stub", () => {
    expect(TEAM_6925_RESOURCES.length).toBeGreaterThanOrEqual(4);
    expect(TEAM_6925_WEEKS.length).toBeGreaterThanOrEqual(5);
    expect(totalLabMinutes()).toBeGreaterThan(300);
  });

  it("has a full programming track and a full mechanical track", () => {
    expect(LAB_TRACKS.map((track) => track.id)).toEqual(["programming", "mechanical"]);
    for (const { id } of LAB_TRACKS) {
      const weeks = weeksForTrack(id);
      expect(weeks.length, id).toBeGreaterThanOrEqual(8);
      expect(weeks.map((week) => week.week), id).toEqual(weeks.map((_, index) => index + 1));
      expect(resourcesForTrack(id).length, id).toBeGreaterThanOrEqual(3);
      expect(trackMinutes(id), id).toBeGreaterThan(600);
    }
    expect(trackMinutes("programming") + trackMinutes("mechanical")).toBe(totalLabMinutes());
    // The CopyCommand block renders under this group.
    expect(TEAM_6925_RESOURCES.find((group) => group.id === "laptop-setup")?.track).toBe("programming");
  });

  it("uses unique ids so the jump links land", () => {
    const ids = [...TEAM_6925_RESOURCES.map((group) => group.id), ...TEAM_6925_WEEKS.map((week) => week.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses https official docs and never the dead CAD Video Tutor host", () => {
    for (const link of allTeam6925Links()) {
      expect(link.href.startsWith("https://") || link.href.startsWith("/"), link.href).toBe(true);
      expect(link.href.toLowerCase().includes("thecadvideotutor")).toBe(false);
    }
    const hrefs = allTeam6925Links().map((link) => link.href);
    expect(hrefs.some((href) => href.includes("docs.limelightvision.io"))).toBe(true);
    expect(hrefs.some((href) => href.includes("docs.wpilib.org"))).toBe(true);
    expect(hrefs.some((href) => href.includes("education.github.com"))).toBe(true);
    expect(hrefs.some((href) => href.includes("www.cadvideotutor.com"))).toBe(true);
  });

  it("only links to in-app routes that exist", () => {
    const appDir = join(__dirname, "../../app");
    for (const link of allTeam6925Links()) {
      if (!link.href.startsWith("/")) continue;
      const route = link.href.split("#")[0]!.slice(1);
      expect(existsSync(join(appDir, route, "page.tsx")), link.href).toBe(true);
    }
  });

  it("passes orgId into withOrgHref so the lab typechecks", () => {
    const lab = readFileSync(join(__dirname, "../../app/learn/6925/team-6925-lab.tsx"), "utf8");
    expect(lab).not.toMatch(/withOrgHref\([^,)]+\)/);
    expect(lab).toMatch(/withOrgHref\("\/build", null\)/);
  });

  it("gives every group and week exactly one primary link", () => {
    for (const group of TEAM_6925_RESOURCES) {
      expect(group.links.filter((link) => link.primary)).toHaveLength(1);
    }
    for (const week of TEAM_6925_WEEKS) {
      expect(week.links.filter((link) => link.primary)).toHaveLength(1);
      expect(week.why.trim().length).toBeGreaterThan(40);
      expect(week.steps.length).toBeGreaterThan(2);
    }
  });

  it("writes weeks a student can act on and check", () => {
    for (const week of TEAM_6925_WEEKS) {
      expect(week.steps.length, week.id).toBeLessThanOrEqual(6);
      expect(week.minutes, week.id).toBeGreaterThanOrEqual(45);
      expect(week.minutes, week.id).toBeLessThanOrEqual(240);
      expect(week.verify, week.id).not.toMatch(/\bunderstand/i);
      expectPlainCopy(week.why);
      expectPlainCopy(week.verify);
    }
    for (const group of TEAM_6925_RESOURCES) expectPlainCopy(group.blurb);
  });

  it("points the setup command at a live, public copy of the script", () => {
    expect(TEAM_6925_SETUP_COMMAND).toBe(`irm ${LIVE_SITE_ORIGIN}/team-setup.ps1 | iex`);
    const script = readFileSync(join(__dirname, "../../public/team-setup.ps1"), "utf8");
    expect(script).toContain(TEAM_6925_SETUP_COMMAND);
    // `irm | iex` cannot follow a sign-in redirect, so the proxy must let it through.
    const proxy = readFileSync(join(__dirname, "../../proxy.ts"), "utf8");
    expect(proxy).toMatch(/^\s*"\/team-setup\.ps1",$/m);
  });
});
