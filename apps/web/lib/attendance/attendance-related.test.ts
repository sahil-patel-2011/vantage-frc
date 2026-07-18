import { describe, expect, it } from "vitest";
import type { AttendanceEvent, AttendanceMember } from "../attendance";
import { teamHubRelatedLinks } from "../team/team-related";
import {
  ATTENDANCE_LIST_FILTERS,
  ATTENDANCE_TEAM_RELATED_INCLUDE,
  attendanceCalendarHref,
  attendanceEventHref,
  attendanceNextActions,
  attendancePracticeHref,
  filterAttendanceEvents,
  formatEventEvidence,
  formatSessionOption,
  membersNotMarked,
  pickDefaultSession,
} from "./attendance-related";

const E1 = "44444444-4444-4444-8444-444444444444";
const E2 = "55555555-5555-4555-8555-555555555555";

function event(overrides: Partial<AttendanceEvent> = {}): AttendanceEvent {
  return {
    id: E1,
    title: "Tuesday practice",
    kind: "practice",
    occurredOn: "2026-02-10",
    creditHours: 2,
    seasonYear: 2026,
    createdByName: "Lead",
    entries: [],
    ...overrides,
  };
}

const members: AttendanceMember[] = [
  { userId: "u1", name: "Ada" },
  { userId: "u2", name: "Grace" },
];

describe("attendance Soft-UI helpers", () => {
  it("exposes Practice / Calendar / Messages in the Team strip", () => {
    expect(ATTENDANCE_TEAM_RELATED_INCLUDE).toEqual(["practice", "calendar", "messages"]);
    const links = teamHubRelatedLinks("org-1", {
      active: "attendance",
      include: ATTENDANCE_TEAM_RELATED_INCLUDE,
    });
    expect(links.map((l) => l.id)).toEqual(["practice", "calendar", "messages"]);
    expect(links.every((l) => l.href.includes("orgId=org-1"))).toBe(true);
    expect(links.every((l) => !/demo/i.test(l.label))).toBe(true);
  });

  it("builds event deep links and Practice / Calendar cross-links", () => {
    expect(attendanceEventHref("org-1", { eventId: "ev-1", occurredOn: "2026-02-10" })).toBe(
      "/team?tab=attendance&orgId=org-1&eventId=ev-1&occurredOn=2026-02-10",
    );
    expect(attendancePracticeHref("org-1")).toContain("tab=practice");
    expect(attendanceCalendarHref("org-1")).toContain("tab=calendar");
  });

  it("formats evidence from real marks — never DEMO %", () => {
    expect(formatEventEvidence(event())).toBe("No one marked yet");
    expect(
      formatEventEvidence(
        event({
          entries: [
            {
              id: "a",
              eventId: E1,
              personName: "Ada",
              role: "student",
              hours: null,
              createdAt: "2026-02-10T22:00:00.000Z",
            },
            {
              id: "b",
              eventId: E1,
              personName: "Grace",
              role: "mentor",
              hours: 1.5,
              createdAt: "2026-02-10T22:00:00.000Z",
            },
          ],
        }),
      ),
    ).toBe("2 present · 3.5h credited · 1 mentor");
    expect(JSON.stringify(formatEventEvidence(event()))).not.toMatch(/%|demo/i);
  });

  it("formats session options from occurred_on only", () => {
    expect(formatSessionOption({ title: "Sat", occurredOn: "2026-02-14", kind: "practice" }, () => "Sat, Feb 14")).toBe(
      "Sat · Sat, Feb 14 · Practice",
    );
  });

  it("filters sessions and finds unmarked roster members", () => {
    const events = [
      event({ id: E1, title: "Empty roll", entries: [] }),
      event({
        id: E2,
        title: "Full roll",
        kind: "meeting",
        entries: [
          {
            id: "a",
            eventId: E2,
            personName: "Ada",
            role: "student",
            hours: 1,
            createdAt: "2026-02-10T22:00:00.000Z",
          },
          {
            id: "b",
            eventId: E2,
            personName: "Grace",
            role: "mentor",
            hours: 1,
            createdAt: "2026-02-10T22:00:00.000Z",
          },
        ],
      }),
    ];
    expect(filterAttendanceEvents(events, "empty").map((e) => e.id)).toEqual([E1]);
    expect(filterAttendanceEvents(events, "practice").map((e) => e.id)).toEqual([E1]);
    expect(filterAttendanceEvents(events, "unmarked", { members }).map((e) => e.id)).toEqual([E1]);
    expect(filterAttendanceEvents(events, "all", { query: "full" }).map((e) => e.id)).toEqual([E2]);
    expect(membersNotMarked(members, events[0]).map((m) => m.name)).toEqual(["Ada", "Grace"]);
    expect(membersNotMarked(members, events[1])).toEqual([]);
    expect(ATTENDANCE_LIST_FILTERS.some((f) => f.id === "unmarked")).toBe(true);
  });

  it("picks focused session from deep link without inventing rows", () => {
    const events = [event({ id: E1 }), event({ id: E2, occurredOn: "2026-02-12" })];
    expect(pickDefaultSession([])).toBeNull();
    expect(pickDefaultSession(events, { eventId: E2 })).toBe(E2);
    expect(pickDefaultSession(events, { occurredOn: "2026-02-12" })).toBe(E2);
    expect(pickDefaultSession(events)).toBe(E1);
  });

  it("builds empty-state next actions without DEMO rates", () => {
    const empty = attendanceNextActions({
      orgId: "org-1",
      eventCount: 0,
      emptyRollCount: 0,
      canManage: true,
    });
    expect(empty.map((a) => a.id)).toEqual(["first-roll", "calendar", "practice"]);
    expect(empty.every((a) => !/demo|attendance\s*%/i.test(`${a.label} ${a.detail}`))).toBe(true);

    const ready = attendanceNextActions({
      orgId: "org-1",
      eventCount: 2,
      emptyRollCount: 1,
      canManage: true,
      selectedEventId: E1,
    });
    expect(ready[0]?.id).toBe("mark-empty");
    expect(ready.some((a) => a.id === "practice")).toBe(true);
    expect(ready.some((a) => a.id === "calendar")).toBe(true);

    expect(attendanceNextActions({ eventCount: 0, emptyRollCount: 0, canManage: false }).map((a) => a.id)).toEqual([
      "workspace",
    ]);
  });
});
