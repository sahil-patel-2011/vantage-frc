import { describe, expect, it } from "vitest";
import {
  HOURS_RELATED_INCLUDE,
  classifyHoursShell,
  hoursNextActions,
  hoursRelatedLinks,
  hoursSetupSteps,
  hoursShellCopy,
} from "./hours-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("hoursRelatedLinks", () => {
  it("builds Attendance / My hours / Shop kiosk via hubHref / withOrgHref", () => {
    const links = hoursRelatedLinks("org-1", { include: [...HOURS_RELATED_INCLUDE] });
    expect(links.map((link) => link.id)).toEqual(["attendance", "hours-self-view", "kiosk"]);
    expect(links.find((link) => link.id === "attendance")?.href).toBe(
      "/team?tab=attendance&orgId=org-1",
    );
    expect(links.find((link) => link.id === "hours-self-view")?.href).toBe(
      "/team?tab=hours-self-view&orgId=org-1",
    );
    expect(links.find((link) => link.id === "kiosk")?.href).toBe("/hours/kiosk?orgId=org-1");
  });
});

describe("hoursSetupSteps", () => {
  it("keeps Choose your team; Attendance / My hours / kiosk live on the related strip", () => {
    const steps = hoursSetupSteps("org-1");
    expect(steps.map((step) => step.id)).toEqual(["workspace"]);
    expect(steps[0]?.href).toBe("/workspace?orgId=org-1");
  });
});

describe("hoursNextActions", () => {
  it("gates on workspace when a team is missing", () => {
    const actions = hoursNextActions({ orgId: null, shell: "setup" });
    expect(actions.map((action) => action.id)).toEqual(["workspace"]);
    expect(actions[0]?.primary).toBe(true);
    expect(actions[0]?.href).toBe("/workspace");
  });

  it("does not add a second guided list on a ready board", () => {
    expect(hoursNextActions({ orgId: "org-1", shell: "ready" })).toEqual([]);
  });

  it("keeps Retry as the only error action once related links are stripped", () => {
    const actions = hoursNextActions({ orgId: "org-1", shell: "error" });
    expect(actions.map((action) => action.id)).toEqual(["retry"]);
    expect(actions[0]?.href).toBe("/hours?orgId=org-1");
  });
});

describe("classifyHoursShell / hoursShellCopy", () => {
  it("classifies setup when no team is selected", () => {
    expect(classifyHoursShell({ loading: false, orgId: null })).toBe("setup");
    expect(classifyHoursShell({ loading: false, status: "setup_required", orgId: "org-1" })).toBe(
      "setup",
    );
    expect(classifyHoursShell({ loading: true })).toBe("loading");
    expect(classifyHoursShell({ loading: false, fetchFailed: true, orgId: "org-1" })).toBe("error");
    expect(classifyHoursShell({ loading: false, status: "ready", orgId: "org-1" })).toBe("ready");
  });

  it("uses student words for every shell", () => {
    for (const kind of ["loading", "error", "setup", "ready"] as const) {
      const copy = hoursShellCopy(kind);
      expectPlainCopy(`${copy.title} ${copy.description} ${copy.badge ?? ""}`);
    }
  });
});
