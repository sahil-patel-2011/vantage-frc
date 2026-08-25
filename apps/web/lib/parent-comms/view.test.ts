import { describe, expect, it } from "vitest";
import {
  classifyParentView,
  expandParentViewEvents,
  type ParentViewRawEvent,
} from "./view";

const NOW = new Date("2026-08-24T12:00:00.000Z");

function raw(overrides: Partial<ParentViewRawEvent> = {}): ParentViewRawEvent {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Build session",
    kind: "build",
    location: "Shop",
    startsAt: "2026-08-25T22:00:00.000Z",
    endsAt: "2026-08-26T01:00:00.000Z",
    rrule: null,
    recurrenceEnd: null,
    timeZone: null,
    seriesId: null,
    exceptions: null,
    studentRsvp: null,
    ...overrides,
  };
}

describe("expandParentViewEvents", () => {
  it("keeps concrete events inside the 30-day window only", () => {
    const events = expandParentViewEvents(
      [
        raw(),
        raw({ id: "2", startsAt: "2026-05-01T00:00:00.000Z" }),
        raw({ id: "3", startsAt: "2027-01-01T00:00:00.000Z" }),
      ],
      NOW,
    );
    expect(events.map((event) => event.id)).toEqual(["11111111-1111-4111-8111-111111111111"]);
  });

  it("expands a weekly series into occurrences without an RSVP", () => {
    const events = expandParentViewEvents(
      [
        raw({
          rrule: "FREQ=WEEKLY;BYDAY=TU,TH",
          startsAt: "2026-08-04T22:00:00.000Z",
          endsAt: "2026-08-05T01:00:00.000Z",
          timeZone: "UTC",
          studentRsvp: "going",
        }),
      ],
      NOW,
    );
    expect(events.length).toBeGreaterThanOrEqual(8);
    expect(events.every((event) => event.studentRsvp === null)).toBe(true);
    expect(events[0].startsAt).toBe("2026-08-25T22:00:00.000Z");
    expect(events[0].endsAt).toBe("2026-08-26T01:00:00.000Z");
    expect(events[0].id).toContain("#");
  });

  it("suppresses excepted occurrences", () => {
    const events = expandParentViewEvents(
      [
        raw({
          rrule: "FREQ=WEEKLY;BYDAY=TU",
          startsAt: "2026-08-04T22:00:00.000Z",
          endsAt: null,
          exceptions: [{ occurrenceDate: "2026-08-25T22:00:00.000Z", action: "skipped" }],
        }),
      ],
      NOW,
    );
    expect(events.some((event) => event.startsAt === "2026-08-25T22:00:00.000Z")).toBe(false);
    expect(events.some((event) => event.startsAt === "2026-09-01T22:00:00.000Z")).toBe(true);
  });

  it("degrades an invalid rrule to the master's own start", () => {
    const events = expandParentViewEvents([raw({ rrule: "FREQ=BOGUS-JUNK" })], NOW);
    expect(events).toHaveLength(1);
    expect(events[0].startsAt).toBe("2026-08-25T22:00:00.000Z");
  });

  it("keeps the linked student's rsvp on concrete rows only", () => {
    const events = expandParentViewEvents([raw({ studentRsvp: "maybe" })], NOW);
    expect(events[0].studentRsvp).toBe("maybe");
    const junk = expandParentViewEvents([raw({ studentRsvp: "definitely" })], NOW);
    expect(junk[0].studentRsvp).toBeNull();
  });
});

describe("classifyParentView", () => {
  it("reports unavailable databases honestly", () => {
    const state = classifyParentView("unavailable", NOW);
    expect(state.status).toBe("setup_required");
  });

  it("is empty when nothing upcoming exists — never invents events", () => {
    const state = classifyParentView(
      { orgName: "Robo Raiders", teamNumber: 1234, studentLabel: "Jordan", studentLinked: false, events: [] },
      NOW,
    );
    expect(state).toMatchObject({ status: "empty", orgName: "Robo Raiders", teamNumber: 1234 });
  });

  it("is ready with expanded, sorted events", () => {
    const state = classifyParentView(
      {
        orgName: "Robo Raiders",
        teamNumber: 1234,
        studentLabel: "",
        studentLinked: true,
        events: [
          raw({ id: "b", startsAt: "2026-08-28T22:00:00.000Z" }),
          raw({ id: "a", startsAt: "2026-08-25T22:00:00.000Z" }),
        ],
      },
      NOW,
    );
    expect(state.status).toBe("ready");
    if (state.status === "ready") {
      expect(state.events.map((event) => event.id)).toEqual(["a", "b"]);
    }
  });
});
