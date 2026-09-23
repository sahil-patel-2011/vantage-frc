import { describe, expect, it } from "vitest";
import { briefingPartnerSyncHref, briefingSetupAction } from "./setup-action";

const ORG = "47003f5c-2d40-4ff4-8dd4-f3a9a12be7b2";

describe("briefingSetupAction", () => {
  it("sends a signed-out empty briefing to the team chooser", () => {
    expect(briefingSetupAction({})).toEqual({ href: "/workspace", label: "Choose your team" });
  });

  it("keeps the team id on Set active event", () => {
    const action = briefingSetupAction({ orgId: ORG, role: "scout" });
    expect(action.label).toBe("Set active event");
    expect(action.href).toContain("orgId=");
    expect(action.href).toContain("command");
  });

  it("sends a missing team number to the team page", () => {
    const action = briefingSetupAction({ orgId: ORG, eventKey: "2026custom-x", teamNumber: null, role: "owner" });
    expect(action.label).toBe("Open your team");
    expect(action.href).toContain(ORG);
  });

  it("sends owners to Team Data once the event is set and the schedule is empty", () => {
    const action = briefingSetupAction({
      orgId: ORG,
      eventKey: "2026custom-x",
      teamNumber: 9999,
      role: "admin",
    });
    expect(action).toEqual({
      href: `/team/data?orgId=${ORG}`,
      label: "Sync Team Data",
    });
  });

  it("sends scouts to Scouting instead of Team Data", () => {
    const action = briefingSetupAction({
      orgId: ORG,
      eventKey: "2026custom-x",
      teamNumber: 9999,
      role: "scout",
    });
    expect(action.label).toBe("Open Scouting");
    expect(action.href).toContain("scouting");
    expect(action.href).toContain(ORG);
    expect(action.href).not.toContain("/team/data");
  });
});

describe("briefingPartnerSyncHref", () => {
  it("keeps Team Data for an owner or admin", () => {
    expect(briefingPartnerSyncHref(ORG, "owner")).toBe(`/team/data?orgId=${ORG}`);
    expect(briefingPartnerSyncHref(ORG, "admin")).toBe(`/team/data?orgId=${ORG}`);
  });

  it("fails closed for a scout and when the role is omitted", () => {
    expect(briefingPartnerSyncHref(ORG, "scout")).toBeNull();
    expect(briefingPartnerSyncHref(ORG, "member")).toBeNull();
    expect(briefingPartnerSyncHref(ORG)).toBeNull();
    expect(briefingPartnerSyncHref(null, "owner")).toBe("/team/data");
  });
});
