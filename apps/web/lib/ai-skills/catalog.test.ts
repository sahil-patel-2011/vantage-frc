import { describe, expect, it } from "vitest";
import {
  AI_SKILL_GROUPS,
  AI_SKILL_ROUTING_ORDER,
  AI_SKILLS,
  aiSkillById,
  aiSkillForPage,
  aiSkillsInGroup,
  askAiHref,
  canSaveSkillDraft,
  chooseAiSkillByKeywords,
  pageLabelFor,
  roleMeets,
} from "./catalog";

describe("Ask AI skill catalog", () => {
  it("gives every skill an id, a short name, one purpose line, starters, data it reads and an owner module", () => {
    const ids = new Set<string>();
    for (const skill of AI_SKILLS) {
      expect(skill.id).toMatch(/^[a-z][a-z-]*$/);
      expect(ids.has(skill.id)).toBe(false);
      ids.add(skill.id);
      expect(skill.name.length).toBeGreaterThan(1);
      expect(skill.name.length).toBeLessThanOrEqual(24);
      expect(skill.purpose).not.toMatch(/\n/);
      expect(skill.starters.length).toBeGreaterThanOrEqual(2);
      expect(skill.starters.length).toBeLessThanOrEqual(4);
      expect(skill.reads.length).toBeGreaterThan(0);
      expect(skill.libModules.length).toBeGreaterThan(0);
      expect(skill.home.path.startsWith("/")).toBe(true);
      expect(skill.guidance).toMatch(/Never invent/);
    }
  });

  it("groups every skill so people can browse, and every group has at least one", () => {
    expect(AI_SKILL_GROUPS.map((group) => group.id)).toEqual([
      "sponsorships",
      "grants",
      "match-strategy",
      "scouting",
      "build-pit",
      "team-running",
      "code-cad",
      "writing",
    ]);
    for (const group of AI_SKILL_GROUPS) expect(aiSkillsInGroup(group.id).length).toBeGreaterThan(0);
    for (const skill of AI_SKILLS) expect(AI_SKILL_GROUPS.some((group) => group.id === skill.group)).toBe(true);
  });

  it("routes every skill by keywords, in one order", () => {
    expect([...AI_SKILL_ROUTING_ORDER].sort()).toEqual(AI_SKILLS.map((skill) => skill.id).sort());
  });

  it("picks the sponsorship skill for the owner's everyday sponsor questions", () => {
    for (const message of [
      "Who should we ask next?",
      "Draft a renewal email to Acme Robotics",
      "Which sponsors haven't we thanked?",
      "help with fundraising",
    ]) {
      expect(chooseAiSkillByKeywords(message)?.id, message).toBe("sponsorships");
    }
  });

  it("prefers the narrow skill when a question names it", () => {
    expect(chooseAiSkillByKeywords("Any matching-gift programs for our parents?")?.id).toBe("matching-gifts");
    expect(chooseAiSkillByKeywords("Which sponsors are at renewal risk?")?.id).toBe("sponsor-roi");
    expect(chooseAiSkillByKeywords("Write our grant report for the Boeing grant")?.id).toBe("grant-reports");
    expect(chooseAiSkillByKeywords("Start the Impact award essay")?.id).toBe("impact-essay");
    expect(chooseAiSkillByKeywords("Should we play defense on 254?")?.id).toBe("defense-planner");
    expect(chooseAiSkillByKeywords("We keep browning out in auto")?.id).toBe("wiring");
    expect(chooseAiSkillByKeywords("Write this week's parent update")?.id).toBe("parent-updates");
    expect(chooseAiSkillByKeywords("What did the last code review flag?")?.id).toBe("code-review");
    expect(chooseAiSkillByKeywords("Help me write a thank-you letter")?.id).toBe("sponsorships");
    expect(chooseAiSkillByKeywords("Rewrite this paragraph")?.id).toBe("writing");
  });

  it("leaves small talk to the model", () => {
    expect(chooseAiSkillByKeywords("hello")).toBeNull();
    expect(chooseAiSkillByKeywords("   ")).toBeNull();
  });

  it("only routes to skills the person may use", () => {
    expect(chooseAiSkillByKeywords("Who should we ask next?", new Set(["writing"]))).toBeNull();
  });

  it("opens Ask AI on the page's skill: hub tab first, then the longest path", () => {
    expect(aiSkillForPage("/business", "?tab=sponsors&orgId=x")?.id).toBe("sponsorships");
    expect(aiSkillForPage("/business", "?tab=grants")?.id).toBe("grants");
    expect(aiSkillForPage("/matching-gift-finder")?.id).toBe("matching-gifts");
    expect(aiSkillForPage("/team/sponsors")?.id).toBe("sponsorships");
    expect(aiSkillForPage("/hours")?.id).toBe("check-ins");
    expect(aiSkillForPage("/robot")?.id).toBe("robot-review");
    expect(aiSkillForPage("/competition", "?tab=picks")?.id).toBe("pick-list-reasons");
    expect(aiSkillForPage("/dashboard")).toBeNull();
    expect(aiSkillForPage("/business", "?tab=orders")).toBeNull();
  });

  it("builds the one Ask AI link every page uses", () => {
    expect(askAiHref()).toBe("/ai");
    expect(askAiHref({ orgId: "org-1", skill: "sponsorships", from: "/business?tab=sponsors" })).toBe(
      "/ai?skill=sponsorships&from=%2Fbusiness%3Ftab%3Dsponsors&orgId=org-1",
    );
    expect(askAiHref({ skill: "not-a-skill", prompt: "  hi  " })).toBe("/ai?prompt=hi");
    expect(askAiHref({ mode: "background" })).toBe("/ai?mode=background");
    expect(aiSkillById("SPONSORSHIPS")?.id).toBe("sponsorships");
    expect(pageLabelFor("/business?tab=sponsors")).toBe("Sponsors");
    expect(pageLabelFor("/matching-gift-finder")).toBe("Matching gift finder");
    expect(pageLabelFor(null)).toBeNull();
  });

  it("lets View only members ask but never offers them a save", () => {
    const sponsorships = aiSkillById("sponsorships");
    expect(roleMeets("viewer", "viewer")).toBe(true);
    expect(roleMeets("viewer", "scout")).toBe(false);
    expect(roleMeets("nobody", "viewer")).toBe(false);
    expect(canSaveSkillDraft(sponsorships, "viewer")).toBe(false);
    expect(canSaveSkillDraft(sponsorships, "scout")).toBe(true);
    expect(canSaveSkillDraft(aiSkillById("wiring"), "owner")).toBe(false);
  });
});
