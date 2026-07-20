import { describe, expect, it } from "vitest";
import {
  LOGISTICS_RELATED_INCLUDE,
  classifyLogisticsShell,
  formatLodgingClarity,
  formatTravelLegClarity,
  logisticsRelatedLinks,
  logisticsSetupSteps,
  logisticsShellCopy,
  logisticsShellNextActions,
} from "./logistics-related";

describe("logistics-related Soft-UI helpers", () => {
  it("builds Event Day / My Day / calendar / visit-invites cross-links", () => {
    const links = logisticsRelatedLinks("org-1", { include: [...LOGISTICS_RELATED_INCLUDE] });
    expect(links.map((l) => l.id)).toEqual(["command", "my-day", "calendar", "visit-invites"]);
    expect(links.find((l) => l.id === "command")?.href).toBe("/competition?tab=command&orgId=org-1");
    expect(links.find((l) => l.id === "my-day")?.href).toBe("/competition?tab=my-day&orgId=org-1");
    expect(links.find((l) => l.id === "calendar")?.href).toContain("/team/calendar");
    expect(links.find((l) => l.id === "calendar")?.href).toContain("tab=trip");
    expect(links.find((l) => l.id === "calendar")?.href).toContain("orgId=org-1");
    expect(links.find((l) => l.id === "visit-invites")?.href).toBe("/visit-invites?orgId=org-1");
  });

  it("excludes the active surface and respects include", () => {
    const links = logisticsRelatedLinks("org-1", { active: "command", include: ["my-day", "calendar"] });
    expect(links.map((l) => l.id)).toEqual(["my-day", "calendar"]);
  });

  it("never uses DEMO labels", () => {
    const links = logisticsRelatedLinks("org-1");
    expect(links.every((l) => !/demo/i.test(l.label))).toBe(true);
  });
});

describe("logistics Soft-UI shells", () => {
  it("classifies loading / error / setup / empty / ready", () => {
    expect(classifyLogisticsShell({ loading: true })).toBe("loading");
    expect(classifyLogisticsShell({ fetchFailed: true, status: null })).toBe("error");
    expect(classifyLogisticsShell({ status: "setup_required" })).toBe("setup");
    expect(classifyLogisticsShell({ status: "ready", tripCount: 0 })).toBe("empty");
    expect(classifyLogisticsShell({ status: "ready", tripCount: 2 })).toBe("ready");
  });

  it("setup steps use hubHref / withOrgHref and never DEMO lodging", () => {
    const steps = logisticsSetupSteps("org-1");
    expect(steps.find((s) => s.id === "workspace")?.href).toBe("/workspace?orgId=org-1");
    expect(steps.find((s) => s.id === "command")?.href).toBe("/competition?tab=command&orgId=org-1");
    expect(steps.every((s) => !/\bDEMO\b/.test(s.label))).toBe(true);
    expect(steps.every((s) => !/demo/i.test(s.href))).toBe(true);
  });

  it("empty shell next actions point mentors at create trip", () => {
    const actions = logisticsShellNextActions({
      orgId: "org-1",
      shell: "empty",
      canManage: true,
    });
    expect(actions[0]?.id).toBe("create");
    expect(actions[0]?.href).toContain("#logistics-create-trip");
    expect(actions.every((a) => !a.href.toLowerCase().includes("/demo"))).toBe(true);
  });

  it("ready shell surfaces lodging gaps for mentors", () => {
    const actions = logisticsShellNextActions({
      orgId: "org-1",
      shell: "ready",
      canManage: true,
      lodgingGaps: 3,
      hotelCount: 1,
      travelLegCount: 2,
    });
    expect(actions[0]?.id).toBe("lodging");
    expect(actions[0]?.detail).toContain("Assign occupants");
  });

  it("shell copy never invents DEMO lodging", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = logisticsShellCopy(kind);
      expect(copy.description).not.toMatch(/\bDEMO lodging\b.*invent/i);
      expect(JSON.stringify(copy)).not.toMatch(/\/demo/i);
    }
  });
});

describe("hotel / travel clarity helpers", () => {
  it("formats lodging without inventing rooms", () => {
    expect(formatLodgingClarity({ hotelName: "Inn", roomLabel: "412" })).toBe("Inn · Room 412");
    expect(formatLodgingClarity({})).toBeNull();
  });

  it("formats travel legs with kind labels", () => {
    expect(
      formatTravelLegClarity({
        kind: "depart_hotel",
        startsAt: "2026-03-01T12:00:00.000Z",
        meetingPoint: "Lobby",
        formatWhen: () => "Sat, Mar 1, 7:00 AM",
      }),
    ).toContain("Leave hotel");
  });
});
