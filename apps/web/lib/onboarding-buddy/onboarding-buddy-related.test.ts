import { describe, expect, it } from "vitest";
import {
  ONBOARDING_BUDDY_RELATED_INCLUDE,
  classifyOnboardingBuddyShell,
  formatOnboardingBuddyCoverage,
  formatOnboardingBuddyMetric,
  isOnboardingBuddyBoardEmpty,
  onboardingBuddyNextActions,
  onboardingBuddyRelatedLinks,
  onboardingBuddySetupSteps,
  onboardingBuddyShellCopy,
  shouldShowOnboardingBuddySummaryTiles,
} from "./onboarding-buddy-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("onboardingBuddyRelatedLinks", () => {
  it("builds Workspace / Onboarding / Team Data via withOrgHref", () => {
    const links = onboardingBuddyRelatedLinks("org-1", {
      include: [...ONBOARDING_BUDDY_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["workspace", "onboarding", "team-data"]);
    expect(links.find((l) => l.id === "workspace")?.href).toBe("/workspace?orgId=org-1");
    expect(links.find((l) => l.id === "onboarding")?.href).toBe("/onboarding?orgId=org-1");
    expect(links.find((l) => l.id === "team-data")?.href).toBe("/team/data?orgId=org-1");
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(onboardingBuddyRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
  });
});

describe("onboardingBuddySetupSteps", () => {
  it("uses hubHref / withOrgHref and never DEMO progress", () => {
    const steps = onboardingBuddySetupSteps("org-1");
    expect(steps.find((s) => s.id === "workspace")?.href).toBe("/workspace?orgId=org-1");
    expect(steps.find((s) => s.id === "onboarding")?.href).toBe("/onboarding?orgId=org-1");
    expect(steps.find((s) => s.id === "team-data")?.href).toBe("/team/data?orgId=org-1");
    expect(steps.find((s) => s.id === "team")?.href).toBe(
      "/team?tab=onboarding-buddy&orgId=org-1",
    );
    expect(steps.every((s) => !/\bDEMO\b/.test(s.label))).toBe(true);
    expect(steps.every((s) => !/demo/i.test(s.href))).toBe(true);
  });
});

describe("Onboarding Buddy Soft-UI metrics", () => {
  it("formats real counts only", () => {
    expect(formatOnboardingBuddyMetric(3, true)).toBe("3");
    expect(formatOnboardingBuddyMetric(0, false)).toBe("…");
    expect(formatOnboardingBuddyMetric(-1, true)).toBe("0");
  });

  it("formats coverage without inventing DEMO progress", () => {
    expect(formatOnboardingBuddyCoverage(0.5, true)).toBe("50%");
    expect(formatOnboardingBuddyCoverage(0, false)).toBe("…");
    expect(formatOnboardingBuddyCoverage(2, true)).toBe("100%");
  });

  it("hides summary tiles without real board activity", () => {
    expect(
      shouldShowOnboardingBuddySummaryTiles({
        memberCount: 0,
        pairingCount: 0,
        unpairedCount: 0,
      }),
    ).toBe(false);
    expect(
      shouldShowOnboardingBuddySummaryTiles({
        memberCount: 2,
        pairingCount: 0,
        unpairedCount: 0,
      }),
    ).toBe(false);
    expect(
      shouldShowOnboardingBuddySummaryTiles({
        memberCount: 2,
        pairingCount: 0,
        unpairedCount: 1,
      }),
    ).toBe(true);
  });

  it("treats zero pairings as empty", () => {
    expect(isOnboardingBuddyBoardEmpty({ pairingCount: 0 })).toBe(true);
    expect(isOnboardingBuddyBoardEmpty({ pairingCount: 2 })).toBe(false);
  });
});

describe("classifyOnboardingBuddyShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO progress", () => {
    expect(classifyOnboardingBuddyShell({ loading: true })).toBe("loading");
    expect(classifyOnboardingBuddyShell({ fetchFailed: true, orgId: "o" })).toBe("error");
    expect(classifyOnboardingBuddyShell({ status: "setup_required" })).toBe("setup");
    expect(classifyOnboardingBuddyShell({ orgId: null, status: "live" })).toBe("setup");
    expect(
      classifyOnboardingBuddyShell({ orgId: "o", status: "live", pairingCount: 0 }),
    ).toBe("empty");
    expect(
      classifyOnboardingBuddyShell({ orgId: "o", status: "live", pairingCount: 1 }),
    ).toBe("ready");
  });
});

describe("onboardingBuddyShellCopy", () => {
  it("refuses invented DEMO progress in empty/setup copy", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = onboardingBuddyShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
    }
    expectPlainCopy(onboardingBuddyShellCopy("empty").description);
    expect(onboardingBuddyShellCopy("setup").badge).toBe("Setup required");
  });
});

describe("onboardingBuddyNextActions", () => {
  it("prioritizes workspace when no org", () => {
    const actions = onboardingBuddyNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "onboarding")).toBe(true);
    expect(actions.some((a) => a.id === "team-data")).toBe(true);
  });

  it("empty shell points at pair + Workspace / Onboarding / Team Data", () => {
    const actions = onboardingBuddyNextActions({
      orgId: "org-1",
      shell: "empty",
      unpairedCount: 2,
      pairingCount: 0,
    });
    expect(actions[0]?.id).toBe("pair");
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["onboarding", "team-data", "workspace"]),
    );
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
    expect(actions.every((a) => !/demo/i.test(a.href))).toBe(true);
  });

  it("ready boards prioritize unpaired review without DEMO progress", () => {
    const actions = onboardingBuddyNextActions({
      orgId: "org-1",
      shell: "ready",
      unpairedCount: 1,
      pairingCount: 3,
      memberCount: 5,
    });
    expect(actions[0]?.id).toBe("unpaired");
    expect(actions.some((a) => a.id === "team-data")).toBe(true);
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
  });
});
