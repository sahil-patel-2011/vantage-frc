import { describe, expect, it } from "vitest";
import type { DriverSession } from "../driver-practice";
import {
  PRACTICE_TEAM_RELATED_INCLUDE,
  attendanceRollCallHref,
  formatAttendanceOption,
  formatSessionEvidence,
  practiceNextActions,
} from "./practice-related";

function session(partial: Partial<DriverSession> & Pick<DriverSession, "id" | "title">): DriverSession {
  return {
    eventKey: null,
    sessionDate: "2026-07-10",
    driverUserId: null,
    driverName: null,
    location: "",
    goal: "",
    notes: "",
    attendanceEventId: null,
    attendanceEventTitle: null,
    attendanceOccurredOn: null,
    buildTaskId: null,
    buildTaskTitle: null,
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
    cycles: [],
    ...partial,
  };
}

describe("practice Soft-UI helpers", () => {
  it("builds attendance roll-call links with eventId and occurred_on", () => {
    expect(attendanceRollCallHref("org-1", { eventId: "ev-1", occurredOn: "2026-07-12" })).toBe(
      "/team?tab=attendance&orgId=org-1&eventId=ev-1&occurredOn=2026-07-12",
    );
    expect(attendanceRollCallHref(null)).toBe("/team?tab=attendance");
  });

  it("formats attendance options from occurred_on — never attendance %", () => {
    expect(
      formatAttendanceOption({ title: "Sat practice", occurredOn: "2026-07-12", kind: "practice" }, () => "Sat, Jul 12"),
    ).toBe("Sat practice · Sat, Jul 12 · practice");
    expect(JSON.stringify(formatAttendanceOption({ title: "x", occurredOn: "2026-07-12", kind: "practice" }, (d) => d))).not.toMatch(
      /%/,
    );
  });

  it("formats session evidence from logged cycles only", () => {
    expect(formatSessionEvidence(session({ id: "s1", title: "Empty" }))).toBe("No reps logged yet");
    expect(
      formatSessionEvidence(
        session({
          id: "s2",
          title: "Field",
          goal: "Sub-6s",
          attendanceEventTitle: "Sat roll",
          cycles: [
            {
              id: "c1",
              sessionId: "s2",
              action: "Score",
              seconds: 5,
              success: true,
              note: "",
              repIndex: 0,
              createdAt: "2026-07-10T00:00:00.000Z",
            },
          ],
        }),
      ),
    ).toBe("1 rep · 5s avg · 100% made · Has goal · Roll call linked");
  });

  it("asks for first session when schedule is empty", () => {
    const actions = practiceNextActions({ orgId: "org-1", sessions: [], attendanceEventCount: 0 });
    expect(actions[0]?.id).toBe("first-session");
    expect(actions.some((a) => a.id === "calendar")).toBe(true);
    expect(actions.some((a) => a.id === "attendance")).toBe(true);
    expect(actions.every((a) => !/demo/i.test(`${a.label} ${a.detail}`))).toBe(true);
    expect(actions.every((a) => !/attendance\s*%/i.test(`${a.label} ${a.detail}`))).toBe(true);
  });

  it("prioritizes goals and roll-call links without DEMO metrics", () => {
    const actions = practiceNextActions({
      orgId: "org-1",
      attendanceEventCount: 2,
      sessions: [
        session({
          id: "s1",
          title: "Tuesday",
          goal: "",
          attendanceEventId: null,
          cycles: [],
        }),
      ],
    });
    expect(actions.map((a) => a.id)).toEqual(expect.arrayContaining(["add-goal", "log-reps", "link-roll"]));
    expect(actions.every((a) => !/demo/i.test(`${a.label} ${a.detail}`))).toBe(true);
  });

  it("uses focused Team related includes without DEMO labels", () => {
    expect(PRACTICE_TEAM_RELATED_INCLUDE).toEqual(["calendar", "attendance", "batteries", "messages"]);
    expect(PRACTICE_TEAM_RELATED_INCLUDE.every((id) => !/demo/i.test(id))).toBe(true);
  });

  it("requires workspace before next actions", () => {
    expect(practiceNextActions({ sessions: [], attendanceEventCount: 0 }).map((a) => a.id)).toEqual(["workspace"]);
  });
});
