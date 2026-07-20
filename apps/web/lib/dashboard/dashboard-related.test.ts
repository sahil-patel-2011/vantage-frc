import { describe, expect, it } from "vitest";
import {
  classifyDashboardShell,
  dashboardHubHref,
  dashboardHubLinks,
  dashboardNextActions,
  dashboardSetupSteps,
} from "./dashboard-related";

const ORG = "11111111-1111-1111-1111-111111111111";

describe("dashboard Soft-UI related", () => {
  it("classifies honest shells without inventing DEMO readiness", () => {
    expect(classifyDashboardShell({ loaded: false })).toBe("loading");
    expect(classifyDashboardShell({ loaded: true, orgId: null })).toBe("no_org");
    expect(classifyDashboardShell({ loaded: true, orgId: ORG, tbaConfigured: false })).toBe("tba");
    expect(classifyDashboardShell({ loaded: true, orgId: ORG, setupRequired: true })).toBe("setup");
    expect(classifyDashboardShell({ loaded: true, orgId: ORG, setupRequired: false, tbaConfigured: true })).toBe(
      "ready",
    );
  });

  it("builds six-pillar hub links with hubHref / withOrgHref", () => {
    const links = dashboardHubLinks(ORG);
    expect(links.map((link) => link.id)).toEqual([
      "competition",
      "team",
      "logistics",
      "business",
      "build",
      "ai",
    ]);
    expect(dashboardHubHref("competition", ORG)).toContain("orgId=");
    expect(dashboardHubHref("competition", ORG)).toContain("tab=command");
    expect(dashboardHubHref("logistics", ORG)).toBe(`/logistics?orgId=${ORG}`);
    expect(dashboardHubHref("ai", null)).toBe("/ai?tab=chat");
  });

  it("keeps no-org next actions invite-safe and DEMO-free", () => {
    const actions = dashboardNextActions({ orgId: null, shell: "no_org" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions.some((action) => action.href === "/invite")).toBe(true);
    expect(actions.every((action) => !/demo/i.test(`${action.label} ${action.detail}`))).toBe(true);
  });

  it("marks setup steps honestly when TBA and event are missing", () => {
    const steps = dashboardSetupSteps({
      orgId: ORG,
      setupRequired: true,
      tbaConfigured: false,
      hasScoutingSchemas: false,
      hasAiProvider: false,
    });
    expect(steps.find((step) => step.id === "workspace")?.state).toBe("done");
    expect(steps.find((step) => step.id === "event")?.state).toBe("current");
    expect(steps.find((step) => step.id === "tba")?.state).toBe("current");
    expect(steps.find((step) => step.id === "tba")?.href).toContain("orgId=");
    expect(steps.find((step) => step.id === "ai")?.href).toContain("/team/ai-keys");
  });

  it("points missing AI provider next action at AI API keys", () => {
    const actions = dashboardNextActions({
      orgId: ORG,
      shell: "ready",
      hasAiProvider: false,
    });
    const ai = actions.find((action) => action.id === "ai-provider");
    expect(ai?.href).toBe(`/team/ai-keys?orgId=${ORG}`);
    expect(ai?.label.toLowerCase()).toContain("api keys");
  });

  it("keeps ready next actions to blockers only — no hub tour", () => {
    const actions = dashboardNextActions({
      orgId: ORG,
      shell: "ready",
      hasScoutingSchemas: true,
      hasAiProvider: true,
    });
    expect(actions).toEqual([]);
  });
});
