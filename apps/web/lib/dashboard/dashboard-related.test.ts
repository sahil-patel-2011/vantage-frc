import { describe, expect, it } from "vitest";
import {
  classifyDashboardShell,
  dashboardHubHref,
  dashboardHubLinks,
  dashboardNextActions,
  dashboardSetupBannerLabel,
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

  it("keeps no-org next actions as one invite path", () => {
    const actions = dashboardNextActions({ orgId: null, shell: "no_org" });
    expect(actions).toHaveLength(1);
    expect(actions[0]?.href).toBe("/invite");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.every((action) => !/demo/i.test(`${action.label} ${action.detail}`))).toBe(true);
  });

  it("marks setup steps honestly when TBA and event are missing", () => {
    const steps = dashboardSetupSteps({
      orgId: ORG,
      setupRequired: true,
      tbaConfigured: false,
      hasScoutingSchemas: false,
      hasAiProvider: false,
      role: "owner",
    });
    expect(steps.find((step) => step.id === "workspace")?.state).toBe("done");
    expect(steps.find((step) => step.id === "workspace")?.label).toBe("Your team");
    expect(steps.find((step) => step.id === "workspace")?.detail).not.toMatch(/accept an invite/i);
    expect(steps.find((step) => step.id === "event")?.state).toBe("current");
    expect(steps.find((step) => step.id === "tba")?.state).toBe("current");
    expect(steps.find((step) => step.id === "tba")?.href).toContain("orgId=");
    expect(steps.find((step) => step.id === "ai")?.href).toContain("/team/ai-keys");
  });

  it("names the first Home step Choose a team when no team is selected", () => {
    const steps = dashboardSetupSteps({ orgId: null });
    expect(steps.find((step) => step.id === "workspace")?.label).toBe("Choose a team");
    expect(steps.find((step) => step.id === "workspace")?.href).toBe("/invite");
  });

  it("points missing AI provider next action at AI API keys for owners", () => {
    const actions = dashboardNextActions({
      orgId: ORG,
      shell: "ready",
      hasAiProvider: false,
      role: "owner",
    });
    const ai = actions.find((action) => action.id === "ai-provider");
    expect(ai?.href).toBe(`/team/ai-keys?orgId=${ORG}`);
    expect(ai?.label.toLowerCase()).toMatch(/ai keys|api keys/);
  });

  it("hides AI key next action from non-admin members", () => {
    const actions = dashboardNextActions({
      orgId: ORG,
      shell: "ready",
      hasAiProvider: false,
      role: "member",
    });
    expect(actions.find((action) => action.id === "ai-provider")).toBeUndefined();
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

  it("uses student words for the first-run banner CTA", () => {
    expect(
      dashboardSetupBannerLabel({ id: "invite", label: "Invite", detail: "", href: "/invite", state: "current" }),
    ).toBe("Open invite");
    expect(
      dashboardSetupBannerLabel({ id: "tba", label: "TBA", detail: "", href: "/team/data", state: "current" }),
    ).toBe("Connect TBA");
    expect(
      dashboardSetupBannerLabel({ id: "event", label: "Event", detail: "", href: "/command", state: "current" }),
    ).toBe("Set event");
    expect(
      dashboardSetupBannerLabel({ id: "other", label: "Choose your team", detail: "", href: "/workspace", primary: true }),
    ).toBe("Choose your team");
  });
});
