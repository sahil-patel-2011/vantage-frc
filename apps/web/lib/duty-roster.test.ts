import { describe, expect, it } from "vitest";
import {
  defaultDutyTitle,
  dutyToCalendarKind,
  dutyWorkflowLinks,
  filterDutiesForScope,
  groupDutiesByDay,
  isDutyKind,
  parseDutyAction,
  sortDuties,
  type DutyAssignment,
} from "./duty-roster-shared";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const SUB = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";

function duty(overrides: Partial<DutyAssignment> = {}): DutyAssignment {
  return {
    id: "d1",
    title: "Pit block A",
    kind: "pit",
    startsAt: "2026-03-01T14:00:00.000Z",
    endsAt: "2026-03-01T16:00:00.000Z",
    subteamId: null,
    subteamName: null,
    subteamColor: null,
    assignedUserId: USER,
    assignedUserName: "Alex",
    calendarEventId: null,
    notes: "",
    createdByName: "Lead",
    mine: true,
    ...overrides,
  };
}

describe("duty kinds + labels", () => {
  it("accepts known kinds and default titles", () => {
    expect(isDutyKind("scouting")).toBe(true);
    expect(isDutyKind("queue")).toBe(false);
    expect(defaultDutyTitle("drive_team")).toBe("Drive team");
    expect(dutyToCalendarKind("outreach")).toBe("outreach");
    expect(dutyToCalendarKind("scouting")).toBe("event");
  });
});

describe("workflow deep links", () => {
  it("links scout forms, pit, command, and outreach surfaces", () => {
    expect(dutyWorkflowLinks("scouting", ORG).map((l) => l.href)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("/scouting?orgId="),
        expect.stringContaining("/scouting/lineup?orgId="),
      ]),
    );
    expect(dutyWorkflowLinks("pit", ORG).some((l) => l.href.includes("/pit"))).toBe(true);
    expect(dutyWorkflowLinks("drive_team", ORG).some((l) => l.href.includes("/command"))).toBe(true);
    expect(dutyWorkflowLinks("outreach", ORG).some((l) => l.href.includes("/impact"))).toBe(true);
  });
});

describe("team vs personal scope", () => {
  it("keeps all duties for team and filters mine by assignee or subteam", () => {
    const duties = [
      duty({ id: "1", assignedUserId: USER, mine: true }),
      duty({ id: "2", assignedUserId: OTHER, mine: false, title: "Other" }),
      duty({
        id: "3",
        assignedUserId: null,
        subteamId: SUB,
        mine: false,
        title: "Subteam slot",
      }),
    ];
    expect(filterDutiesForScope(duties, "team", USER).map((d) => d.id)).toEqual(["1", "2", "3"]);
    expect(filterDutiesForScope(duties, "mine", USER, [SUB]).map((d) => d.id)).toEqual(["1", "3"]);
    expect(filterDutiesForScope(duties, "mine", USER, []).map((d) => d.id)).toEqual(["1"]);
  });
});

describe("sort + group", () => {
  it("orders by start then title and buckets by UTC day prefix", () => {
    const duties = [
      duty({ id: "b", title: "B", startsAt: "2026-03-02T10:00:00.000Z" }),
      duty({ id: "a", title: "A", startsAt: "2026-03-01T18:00:00.000Z" }),
      duty({ id: "c", title: "C", startsAt: "2026-03-01T12:00:00.000Z" }),
    ];
    expect(sortDuties(duties).map((d) => d.id)).toEqual(["c", "a", "b"]);
    expect(groupDutiesByDay(duties).map((g) => g.day)).toEqual(["2026-03-01", "2026-03-02"]);
  });
});

describe("parseDutyAction", () => {
  it("creates a duty with defaults and rejects bad kinds", () => {
    const created = parseDutyAction({
      action: "create_duty",
      orgId: ORG,
      kind: "scouting",
      startsAt: "2026-03-01T15:00:00.000Z",
      assignedUserId: USER,
    });
    expect(created).toMatchObject({
      action: "create_duty",
      title: "Scouting",
      kind: "scouting",
      assignedUserId: USER,
      linkCalendar: true,
    });

    expect(() =>
      parseDutyAction({
        action: "create_duty",
        orgId: ORG,
        kind: "queue",
        startsAt: "2026-03-01T15:00:00.000Z",
      }),
    ).toThrow(/Kind is invalid/);
  });

  it("parses update and delete", () => {
    const dutyId = "55555555-5555-4555-8555-555555555555";
    expect(
      parseDutyAction({
        action: "update_duty",
        orgId: ORG,
        id: dutyId,
        assignedUserId: USER,
        notes: "Bring laptop",
      }),
    ).toMatchObject({
      action: "update_duty",
      id: dutyId,
      assignedUserId: USER,
      notes: "Bring laptop",
    });
    expect(parseDutyAction({ action: "delete_duty", orgId: ORG, id: dutyId })).toMatchObject({
      action: "delete_duty",
      id: dutyId,
    });
  });
});
