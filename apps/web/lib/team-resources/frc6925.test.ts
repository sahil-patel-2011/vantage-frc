import { describe, expect, it } from "vitest";
import { TEAM_6925_RESOURCES, TEAM_6925_WEEKS, allTeam6925Links, totalLabMinutes } from "./frc6925";

describe("Team 6925 lab", () => {
  it("is a real lab, not a stub", () => {
    expect(TEAM_6925_RESOURCES.length).toBeGreaterThanOrEqual(4);
    expect(TEAM_6925_WEEKS.length).toBeGreaterThanOrEqual(8);
    expect(totalLabMinutes()).toBeGreaterThan(300);
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
});
