import { describe, expect, it } from "vitest";
import {
  VISIT_RELATED_INCLUDE,
  classifyVisitShell,
  visitInvitesShareHref,
  visitNextActions,
  visitRelatedLinks,
  visitSetupSteps,
  visitShellCopy,
} from "./visit-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("visitRelatedLinks", () => {
  it("builds Logistics / Event Day / Calendar cross-links", () => {
    const links = visitRelatedLinks("org-1", { include: [...VISIT_RELATED_INCLUDE] });
    expect(links.map((l) => l.id)).toEqual(["logistics", "command", "calendar"]);
    expect(links.find((l) => l.id === "logistics")?.href).toBe("/logistics?orgId=org-1");
    expect(links.find((l) => l.id === "command")?.href).toBe("/competition?tab=command&orgId=org-1");
    expect(links.find((l) => l.id === "calendar")?.href).toBe("/team?tab=calendar&orgId=org-1");
  });

  it("excludes the active surface and respects include", () => {
    const links = visitRelatedLinks("org-1", {
      active: "logistics",
      include: ["command", "calendar"],
    });
    expect(links.map((l) => l.id)).toEqual(["command", "calendar"]);
  });

  it("never uses DEMO placeholder labels or hrefs", () => {
    const blob = JSON.stringify(visitRelatedLinks("org-1"));
    expect(blob).not.toMatch(/\bDEMO\b/);
    expect(blob.toLowerCase()).not.toContain("/demo");
  });
});

describe("visitInvitesShareHref", () => {
  it("builds org and visit deep links without inventing DEMO paths", () => {
    expect(visitInvitesShareHref("org-1")).toBe("/visit-invites?orgId=org-1");
    expect(visitInvitesShareHref("org-1", "22222222-2222-4222-8222-222222222222")).toBe(
      "/visit-invites?orgId=org-1#visit-22222222-2222-4222-8222-222222222222",
    );
    expect(visitInvitesShareHref(null)).toBe("/visit-invites");
  });
});

describe("visitNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = visitNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
  });

  it("points empty boards at create / Calendar / Logistics — never DEMO invites", () => {
    const actions = visitNextActions({
      orgId: "org-1",
      shell: "empty",
      canManage: true,
      visitCount: 0,
    });
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["create", "calendar", "logistics"]),
    );
    expect(actions.every((a) => !/\bseeded DEMO\b/i.test(`${a.label} ${a.detail}`))).toBe(true);
    expect(actions.every((a) => !a.href.toLowerCase().includes("/demo"))).toBe(true);
  });

  it("ready boards surface share + Calendar + Logistics", () => {
    const actions = visitNextActions({
      orgId: "org-1",
      shell: "ready",
      canManage: true,
      visitCount: 2,
      hostGaps: 0,
    });
    expect(actions.some((a) => a.id === "share")).toBe(true);
    expect(actions.some((a) => a.id === "calendar")).toBe(true);
    expect(actions.some((a) => a.id === "logistics")).toBe(true);
  });

  it("setup with org sends users to Workspace + Logistics + Event Day", () => {
    const actions = visitNextActions({
      orgId: "org-1",
      shell: "setup",
    });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "logistics")).toBe(true);
    expect(actions.some((a) => a.id === "command")).toBe(true);
  });
});

describe("visitShellCopy / visitSetupSteps", () => {
  it("setup steps use hubHref / withOrgHref and never DEMO invites", () => {
    const steps = visitSetupSteps("org-1");
    expect(steps.find((s) => s.id === "workspace")?.href).toBe("/workspace?orgId=org-1");
    expect(steps.find((s) => s.id === "logistics")?.href).toBe("/logistics?orgId=org-1");
    expect(steps.find((s) => s.id === "calendar")?.href).toBe("/team?tab=calendar&orgId=org-1");
    expect(steps.every((s) => !/\bDEMO\b/.test(s.label))).toBe(true);
    expect(steps.every((s) => !/demo/i.test(s.href))).toBe(true);
  });

  it("shell copy never invents DEMO invite rows", () => {
    const copy = visitShellCopy("empty");
    expect(copy.badge).toBe("No visits yet");
    expectPlainCopy(copy.description);
  });
});

describe("classifyVisitShell", () => {
  it("classifies loading / error / setup / empty / ready", () => {
    expect(classifyVisitShell({ loading: true })).toBe("loading");
    expect(classifyVisitShell({ loading: false, fetchFailed: true, status: null })).toBe("error");
    expect(classifyVisitShell({ loading: false, status: "setup_required" })).toBe("setup");
    expect(classifyVisitShell({ loading: false, status: "ready", visitCount: 0 })).toBe("empty");
    expect(classifyVisitShell({ loading: false, status: "ready", visitCount: 3 })).toBe("ready");
  });
});
