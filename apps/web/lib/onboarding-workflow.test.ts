import { describe, expect, it } from "vitest";
import {
  buildOnboardingChecklistSteps,
  buildSeasonOnboardingSteps,
  calendarOnboardingLinks,
  ONBOARDING_PATH_HREFS,
  onboardingHubLinks,
  surfaceOnboardingLinks,
} from "./onboarding-workflow";

const ORG = "11111111-1111-4111-8111-111111111111";

describe("onboarding-workflow", () => {
  it("hub links cover calendar, knowledge, logistics, and kickoff", () => {
    const hrefs = onboardingHubLinks(ORG).map((link) => link.href);
    expect(hrefs.some((h) => h.includes(ONBOARDING_PATH_HREFS.calendar))).toBe(true);
    expect(hrefs.some((h) => h.includes(ONBOARDING_PATH_HREFS.knowledge))).toBe(true);
    expect(hrefs.some((h) => h.includes(ONBOARDING_PATH_HREFS.logistics))).toBe(true);
    expect(hrefs.some((h) => h.includes(ONBOARDING_PATH_HREFS.kickoff))).toBe(true);
    expect(hrefs.every((h) => h.includes(`orgId=${ORG}`))).toBe(true);
  });

  it("surface links omit the current page", () => {
    const links = surfaceOnboardingLinks("knowledge", ORG);
    expect(links.every((link) => !link.href.includes("/team/knowledge?"))).toBe(true);
    expect(links.some((link) => link.href.includes("/kickoff"))).toBe(true);
  });

  it("builds a full checklist with season path steps", () => {
    const steps = buildOnboardingChecklistSteps({
      orgId: ORG,
      hasEventContext: true,
      tbaConfigured: false,
      hasScoutingSchemas: false,
      hasAiProvider: false,
      joinedSubteam: true,
      hasKnowledge: false,
      hasLogistics: false,
      kickoffReady: false,
      knowsNextMatch: true,
    });
    expect(steps.map((s) => s.key)).toEqual([
      "workspace",
      "event",
      "subteam",
      "knowledge",
      "logistics",
      "kickoff",
      "tba",
      "next_match",
      "scouting",
      "ai",
    ]);
    expect(steps.find((s) => s.key === "next_match")?.href).toContain("/my-day");
    expect(steps.find((s) => s.key === "subteam")?.done).toBe(true);
    expect(steps.find((s) => s.key === "knowledge")?.href).toContain("/team/knowledge");
    expect(steps.find((s) => s.key === "logistics")?.href).toContain("/logistics");
    expect(steps.find((s) => s.key === "kickoff")?.href).toContain("/kickoff");
    const tba = steps.find((s) => s.key === "tba");
    expect(tba?.label).toBe("Open Scouting");
    expect(tba?.href).toContain("/scouting");
    expect(tba?.href).not.toContain("/team/data");
  });

  it("keeps Sync Team Data for an owner or admin and closes it otherwise", () => {
    const base = {
      orgId: ORG,
      hasEventContext: true,
      tbaConfigured: false,
      hasScoutingSchemas: false,
      hasAiProvider: false,
      joinedSubteam: true,
      hasKnowledge: true,
      hasLogistics: true,
      kickoffReady: true,
      knowsNextMatch: true,
    };
    const owner = buildOnboardingChecklistSteps({ ...base, canSyncTeamData: true }).find((s) => s.key === "tba");
    expect(owner?.label).toBe("Sync Team Data");
    expect(owner?.href).toContain("/team/data");
    for (const canSyncTeamData of [false, undefined] as const) {
      const step = buildOnboardingChecklistSteps({ ...base, canSyncTeamData }).find((s) => s.key === "tba");
      expect(step?.href).not.toContain("/team/data");
      expect(step?.label).toBe("Open Scouting");
    }
  });

  it("exposes season-only slice for role-based paths", () => {
    const steps = buildSeasonOnboardingSteps({
      orgId: ORG,
      joinedSubteam: false,
      hasKnowledge: true,
      hasLogistics: true,
      kickoffReady: false,
    });
    expect(steps.map((s) => s.key)).toEqual(["subteam", "knowledge", "logistics", "kickoff"]);
    expect(steps.filter((s) => s.done).map((s) => s.key)).toEqual(["knowledge", "logistics"]);
  });

  it("adds onboarding deep links from calendar event kinds", () => {
    const eventLinks = calendarOnboardingLinks("event", ORG);
    expect(eventLinks.some((l) => l.href.includes("/logistics"))).toBe(true);
    expect(eventLinks.some((l) => l.label === "Onboarding checklist")).toBe(true);

    const practice = calendarOnboardingLinks("practice", ORG);
    expect(practice.some((l) => l.href.includes("/team/knowledge"))).toBe(true);
  });
});
