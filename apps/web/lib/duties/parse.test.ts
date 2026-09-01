import { describe, expect, it } from "vitest";
import { defaultWatchTitle, isWatchActionName, isWatchKind, parseWatchAction } from "./parse";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const DUTY = "55555555-5555-4555-8555-555555555555";

describe("watch kinds", () => {
  it("accepts on-duty and chaperone and rejects roster kinds", () => {
    expect(isWatchKind("on_duty")).toBe(true);
    expect(isWatchKind("chaperone")).toBe(true);
    expect(isWatchKind("scouting")).toBe(false);
    expect(isWatchKind("pit")).toBe(false);
    expect(defaultWatchTitle("chaperone")).toBe("Chaperone");
  });
});

describe("parseWatchAction", () => {
  it("requires a teammate so My Day stays empty until someone is posted", () => {
    expect(() =>
      parseWatchAction({
        action: "assign_watch",
        orgId: ORG,
        kind: "on_duty",
        startsAt: "2026-03-01T15:00:00.000Z",
      }),
    ).toThrow(/Pick a teammate/);
  });

  it("assigns an on-duty slot with defaults", () => {
    expect(
      parseWatchAction({
        action: "assign_watch",
        orgId: ORG,
        kind: "on_duty",
        startsAt: "2026-03-01T15:00:00.000Z",
        assignedUserId: USER,
        phone: "555-0100",
        locationNote: "Pit",
      }),
    ).toMatchObject({
      action: "assign_watch",
      title: "On duty",
      kind: "on_duty",
      assignedUserId: USER,
      phone: "555-0100",
      locationNote: "Pit",
    });
  });

  it("rejects a chaperone kind that is not one of the two watches", () => {
    expect(() =>
      parseWatchAction({
        action: "assign_watch",
        orgId: ORG,
        kind: "driver",
        startsAt: "2026-03-01T15:00:00.000Z",
        assignedUserId: USER,
      }),
    ).toThrow(/Kind is invalid/);
  });

  it("parses update unassign and delete", () => {
    expect(
      parseWatchAction({
        action: "update_watch",
        orgId: ORG,
        id: DUTY,
        assignedUserId: "",
      }),
    ).toMatchObject({ action: "update_watch", id: DUTY, assignedUserId: null });
    expect(parseWatchAction({ action: "delete_watch", orgId: ORG, id: DUTY })).toMatchObject({
      action: "delete_watch",
      id: DUTY,
    });
    expect(isWatchActionName("assign_watch")).toBe(true);
    expect(isWatchActionName("create_duty")).toBe(false);
  });
});
