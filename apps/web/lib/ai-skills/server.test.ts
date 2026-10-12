import { DEFAULT_ORG_AI_POLICY } from "@vantage/billing";
import { describe, expect, it } from "vitest";
import { aiSkillById } from "./catalog";
import {
  availableSkillIds,
  buildSkillTools,
  meteredFeatureForSkill,
  routeSkillForTurn,
  sanitizeSkillPage,
  skillAvailability,
  skillInstructions,
  type SkillAccessFacts,
} from "./server";

const sponsorships = aiSkillById("sponsorships")!;
const checkIns = aiSkillById("check-ins")!;

function facts(partial: Partial<SkillAccessFacts> = {}): SkillAccessFacts {
  return { role: "scout", hubAccess: [], policy: { ...DEFAULT_ORG_AI_POLICY }, ...partial };
}

describe("who may use a skill", () => {
  it("lets every member, View only included, ask the read-only skills", () => {
    expect(skillAvailability(sponsorships, facts({ role: "viewer" })).available).toBe(true);
    expect(skillAvailability(sponsorships, facts({ role: null })).available).toBe(false);
  });

  it("keeps mentor-only skills to owners and admins", () => {
    expect(skillAvailability(checkIns, facts({ role: "scout" }))).toMatchObject({ available: false });
    expect(skillAvailability(checkIns, facts({ role: "admin" })).available).toBe(true);
  });

  it("follows the member's hub access: no Business, no Sponsorships", () => {
    const narrowed = facts({ hubAccess: [{ hubId: "competition", allowedTabIds: [] }] });
    expect(skillAvailability(sponsorships, narrowed)).toMatchObject({ available: false });
    expect(availableSkillIds(narrowed).has("match-prep")).toBe(true);
    // Writing belongs to no hub, so a narrowed member still has it.
    expect(availableSkillIds(narrowed).has("writing")).toBe(true);
  });

  it("follows the team's AI tool allowlist", () => {
    const policy = { ...DEFAULT_ORG_AI_POLICY, toolAllowlistEnabled: true, allowedTools: ["skill.writing"] };
    const ids = availableSkillIds(facts({ policy }));
    expect([...ids]).toEqual(["writing"]);
  });
});

describe("which skill a turn uses", () => {
  const all = availableSkillIds(facts({ role: "owner" }));

  it("keeps the pinned skill even when the words say something else", () => {
    expect(routeSkillForTurn({ pinned: "sponsorships", message: "Should we play defense?", allowed: all }).routed).toMatchObject({
      skill: { id: "sponsorships" },
      source: "pinned",
    });
  });

  it("falls back to keywords, and says so when the pin isn't open to the member", () => {
    const route = routeSkillForTurn({ pinned: "check-ins", message: "Who should we ask next?", allowed: new Set(["sponsorships"]) });
    expect(route.routed).toMatchObject({ skill: { id: "sponsorships" }, source: "keyword" });
    expect(route.pinnedRefused?.reason).toMatch(/isn't available to you/);
  });

  it("leaves a question with no skill words to the model", () => {
    expect(routeSkillForTurn({ pinned: null, message: "hello", allowed: all }).routed).toBeNull();
    expect(routeSkillForTurn({ pinned: "not-a-skill", message: "hello", allowed: all }).routed).toBeNull();
  });
});

describe("metering and rules", () => {
  it("meters a skill turn under the skill id", () => {
    expect(meteredFeatureForSkill(sponsorships, { ...DEFAULT_ORG_AI_POLICY })).toBe("sponsorships");
    expect(meteredFeatureForSkill(null, null)).toBe("chat");
  });

  it("keeps a team with an older feature allowlist working: it meters as chat", () => {
    const policy = { ...DEFAULT_ORG_AI_POLICY, featureAllowlistEnabled: true, allowedFeatures: ["chat"] };
    expect(meteredFeatureForSkill(sponsorships, policy)).toBe("chat");
    const listed = { ...policy, allowedFeatures: ["chat", "sponsorships"] };
    expect(meteredFeatureForSkill(sponsorships, listed)).toBe("sponsorships");
  });

  it("sends the skill's own fixed rules, which forbid inventing records", () => {
    expect(skillInstructions(sponsorships)).toMatch(/Never invent/);
    expect(skillInstructions(sponsorships)).toMatch(/Business › Sponsors/);
  });
});

describe("page context and skill tools", () => {
  it("keeps page context to plain, well-formed data", () => {
    expect(
      sanitizeSkillPage({
        from: "/business?tab=sponsors",
        about: "  Acme\nRobotics  ",
        sponsorId: "not-an-id",
        teamKey: "FRC254",
        matchKey: "2026gacmp_qm12",
      }),
    ).toEqual({ from: "/business?tab=sponsors", about: "Acme Robotics", sponsorId: null, teamKey: "frc254", matchKey: "2026gacmp_qm12" });
    expect(sanitizeSkillPage({ from: "https://evil.example", teamKey: "254" })).toMatchObject({ from: null, teamKey: null });
    expect(sanitizeSkillPage(null)).toEqual({ from: null, about: null, sponsorId: null, teamKey: null, matchKey: null });
  });

  it("registers one skill.<id> tool per skill the member may use, with a schema the model can call", () => {
    const tools = buildSkillTools({ allowed: new Set(["sponsorships", "writing"]), request: "Who next?", page: {} });
    expect(tools.map((tool) => tool.name)).toEqual(["skill.sponsorships", "skill.writing"]);
    expect(tools[0]!.description).toMatch(/Who should we ask next\?/);
    expect(tools[0]!.inputSchema).toMatchObject({ type: "object", properties: { request: { type: "string" } } });
    expect(tools[0]!.parseInput({ about: "Acme" })).toEqual({ request: "Who next?", about: "Acme" });
  });
});
