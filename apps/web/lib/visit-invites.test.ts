import { describe, expect, it } from "vitest";
import {
  calendarTitleForVisit,
  canManageVisits,
  capacityTone,
  countHostGaps,
  demoDayNeedsStudentDemo,
  parseVisitInviteAction,
  rsvpCounts,
  sortVisits,
  upcomingVisitCount,
  visitNeedsHost,
  type VisitInvite,
} from "./visit-invites";

const ORG = "11111111-1111-4111-8111-111111111111";
const VISIT = "22222222-2222-4222-8222-222222222222";
const USER = "44444444-4444-4444-8444-444444444444";

function visit(partial: Partial<VisitInvite> & Pick<VisitInvite, "id" | "title" | "startsAt">): VisitInvite {
  return {
    kind: "shop_tour",
    endsAt: null,
    location: "",
    description: "",
    capacity: null,
    status: "scheduled",
    calendarEventId: null,
    createdBy: USER,
    createdByName: "Mentor",
    hosts: [],
    demos: [],
    rsvps: [],
    myRsvp: null,
    ...partial,
  };
}

describe("canManageVisits", () => {
  it("allows owners, admins, mentors, and coaches", () => {
    expect(canManageVisits({ role: "owner", teamRole: "student" })).toBe(true);
    expect(canManageVisits({ role: "admin", teamRole: null })).toBe(true);
    expect(canManageVisits({ role: "member", teamRole: "mentor" })).toBe(true);
    expect(canManageVisits({ role: "member", teamRole: "coach" })).toBe(true);
  });

  it("denies plain students and parents", () => {
    expect(canManageVisits({ role: "member", teamRole: "student" })).toBe(false);
    expect(canManageVisits({ role: "member", teamRole: "parent" })).toBe(false);
    expect(canManageVisits({ role: null, teamRole: null })).toBe(false);
  });
});

describe("rsvpCounts / capacityTone", () => {
  it("sums responses and party size for going", () => {
    const counts = rsvpCounts([
      { response: "going", partySize: 2 },
      { response: "going", partySize: 1 },
      { response: "maybe", partySize: 4 },
      { response: "no", partySize: 1 },
    ]);
    expect(counts).toEqual({ going: 2, maybe: 1, no: 1, partyGoing: 3 });
  });

  it("tones capacity from open through full", () => {
    expect(capacityTone(0, null)).toBe("open");
    expect(capacityTone(3, 10)).toBe("ok");
    expect(capacityTone(8, 10)).toBe("near");
    expect(capacityTone(10, 10)).toBe("full");
    expect(capacityTone(12, 10)).toBe("full");
  });
});

describe("host gaps / demo day demos", () => {
  it("flags active visits without hosts", () => {
    const open = visit({ id: "1", title: "Tour", startsAt: "2026-04-01T18:00:00.000Z", hosts: [] });
    const hosted = visit({
      id: "2",
      title: "Tour 2",
      startsAt: "2026-04-02T18:00:00.000Z",
      hosts: [{ id: "h1", visitId: "2", userId: null, hostName: "Alex", notes: "", createdBy: USER }],
    });
    const done = visit({ id: "3", title: "Past", startsAt: "2026-01-01T18:00:00.000Z", status: "done", hosts: [] });
    expect(visitNeedsHost(open)).toBe(true);
    expect(visitNeedsHost(hosted)).toBe(false);
    expect(visitNeedsHost(done)).toBe(false);
    expect(countHostGaps([open, hosted, done])).toBe(1);
  });

  it("requires student demos only for active demo days", () => {
    expect(demoDayNeedsStudentDemo(visit({ id: "d", title: "Demos", startsAt: "2026-04-01T18:00:00.000Z", kind: "demo_day" }))).toBe(true);
    expect(demoDayNeedsStudentDemo(visit({ id: "t", title: "Tour", startsAt: "2026-04-01T18:00:00.000Z", kind: "shop_tour" }))).toBe(false);
  });
});

describe("sortVisits / upcomingVisitCount", () => {
  it("sorts scheduled before draft and by start time", () => {
    const sorted = sortVisits([
      visit({ id: "c", title: "C", startsAt: "2026-05-02T18:00:00.000Z", status: "draft" }),
      visit({ id: "b", title: "B", startsAt: "2026-05-03T18:00:00.000Z", status: "scheduled" }),
      visit({ id: "a", title: "A", startsAt: "2026-05-01T18:00:00.000Z", status: "scheduled" }),
    ]);
    expect(sorted.map((v) => v.id)).toEqual(["a", "b", "c"]);
  });

  it("counts upcoming draft and scheduled visits", () => {
    const now = new Date("2026-04-01T12:00:00.000Z");
    const n = upcomingVisitCount(
      [
        visit({ id: "past", title: "Past", startsAt: "2026-03-01T18:00:00.000Z" }),
        visit({ id: "soon", title: "Soon", startsAt: "2026-04-02T18:00:00.000Z" }),
        visit({ id: "cancelled", title: "X", startsAt: "2026-04-03T18:00:00.000Z", status: "cancelled" }),
      ],
      now,
    );
    expect(n).toBe(1);
  });
});

describe("calendarTitleForVisit", () => {
  it("prefixes kind labels when missing from the title", () => {
    expect(calendarTitleForVisit({ title: "District partners", kind: "shop_tour" })).toBe("Shop tour: District partners");
    expect(calendarTitleForVisit({ title: "Shop tour: Already labeled", kind: "shop_tour" })).toBe("Shop tour: Already labeled");
    expect(calendarTitleForVisit({ title: "STEM night", kind: "demo_day" })).toBe("Demo day: STEM night");
  });
});

describe("parseVisitInviteAction", () => {
  it("parses upsert_visit with calendar sync", () => {
    const action = parseVisitInviteAction({
      action: "upsert_visit",
      orgId: ORG,
      title: "Partner night",
      kind: "demo_day",
      startsAt: "2026-05-01T23:00:00.000Z",
      endsAt: null,
      location: "Shop",
      description: "Bring students",
      capacity: 40,
      status: "scheduled",
      syncToCalendar: true,
    });
    expect(action).toMatchObject({
      action: "upsert_visit",
      orgId: ORG,
      title: "Partner night",
      kind: "demo_day",
      capacity: 40,
      syncToCalendar: true,
    });
  });

  it("parses host, demo, and rsvp actions", () => {
    expect(parseVisitInviteAction({ action: "add_host", orgId: ORG, visitId: VISIT, hostName: "Sam", notes: "" })).toMatchObject({ action: "add_host", hostName: "Sam" });
    expect(parseVisitInviteAction({ action: "add_demo", orgId: ORG, visitId: VISIT, demoTitle: "Swerve drive", studentName: "Jordan" })).toMatchObject({ action: "add_demo", demoTitle: "Swerve drive" });
    expect(parseVisitInviteAction({ action: "set_rsvp", orgId: ORG, visitId: VISIT, response: "going", partySize: 2 })).toMatchObject({ action: "set_rsvp", response: "going", partySize: 2 });
    expect(parseVisitInviteAction({ action: "delete_visit", orgId: ORG, id: VISIT }).action).toBe("delete_visit");
  });

  it("rejects unknown actions", () => {
    expect(() => parseVisitInviteAction({ action: "nope", orgId: ORG })).toThrow(/Unknown action/);
  });
});
