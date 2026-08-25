import { describe, expect, it } from "vitest";
import {
  KICKOFF_ACCURACY_NOTE,
  OWNER_ROLE_LABELS,
  ROADMAP_PHASES,
  ROADMAP_TASKS,
  addDays,
  buildRoadmap,
  daysBetween,
  describeWindow,
  isRookieByYear,
  isTaskStatus,
  parseIsoDate,
  phaseById,
  seasonYearForKickoff,
  taskById,
  taskUrgency,
  tasksForPhase,
  windowDates,
} from "./season-roadmap";

const KICKOFF = "2027-01-09"; // a Saturday; every assertion below is relative to it.

describe("roadmap content", () => {
  it("covers preseason through offseason", () => {
    expect(ROADMAP_PHASES.map((phase) => phase.id)).toEqual([
      "preseason",
      "kickoff",
      "build-1",
      "build-2",
      "build-3",
      "build-4",
      "build-5",
      "build-6",
      "pre-event",
      "competition",
      "offseason",
    ]);
    for (const phase of ROADMAP_PHASES) {
      expect(tasksForPhase(phase.id).length, `${phase.id} has no tasks`).toBeGreaterThan(0);
    }
  });

  it("keeps phases in chronological order with sane windows", () => {
    let previousStart = Number.NEGATIVE_INFINITY;
    for (const phase of ROADMAP_PHASES) {
      expect(phase.window.startDay).toBeGreaterThanOrEqual(previousStart);
      expect(phase.window.endDay).toBeGreaterThan(phase.window.startDay);
      previousStart = phase.window.startDay;
    }
  });

  it("gives every task a unique id, a real reason, and an owner", () => {
    const ids = ROADMAP_TASKS.map((task) => task.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const task of ROADMAP_TASKS) {
      expect(task.title.trim().length, `${task.id} title`).toBeGreaterThan(8);
      // The "why" is the whole point — rookies repeat mistakes because nobody said why.
      expect(task.why.trim().length, `${task.id} why`).toBeGreaterThan(60);
      expect(OWNER_ROLE_LABELS[task.ownerRole], `${task.id} owner`).toBeTruthy();
    }
  });

  it("places every task inside the window of the phase it claims", () => {
    for (const task of ROADMAP_TASKS) {
      const phase = phaseById(task.phaseId);
      expect(phase, `${task.id} points at unknown phase ${task.phaseId}`).toBeTruthy();
      const { startDay, endDay } = task.whenRelativeToKickoff;
      expect(endDay, `${task.id} window is inverted`).toBeGreaterThanOrEqual(startDay);
      const overlaps = startDay <= phase!.window.endDay && endDay >= phase!.window.startDay;
      expect(overlaps, `${task.id} sits outside ${task.phaseId}`).toBe(true);
    }
  });

  it("points every task at a canonical free resource instead of authoring content", () => {
    for (const task of ROADMAP_TASKS) {
      expect(task.resourceLinks.length, `${task.id} links nothing`).toBeGreaterThan(0);
      for (const link of task.resourceLinks) {
        expect(link.url.startsWith("https://"), `${task.id} -> ${link.url}`).toBe(true);
        expect(link.label.trim().length).toBeGreaterThan(2);
      }
    }
  });

  it("flags the rookie-critical spine so a veteran team can hide the rest", () => {
    const critical = ROADMAP_TASKS.filter((task) => task.isRookieCritical);
    expect(critical.length).toBeGreaterThan(15);
    expect(critical.length).toBeLessThan(ROADMAP_TASKS.length);
    // The things a rookie coach who "knows nothing of what to do" must not miss.
    for (const id of [
      "register-team",
      "adults-ypp-screening",
      "students-roster-consent",
      "choose-events",
      "secure-season-funding",
      "legal-bumpers",
      "self-inspect-at-home",
      "pit-setup",
      "get-inspected-first",
      "year-two-funding",
    ]) {
      expect(taskById(id)?.isRookieCritical, `${id} should be rookie-critical`).toBe(true);
    }
  });

  it("caveats the ship-rules era rather than asserting a regime", () => {
    const task = taskById("robot-access-rules");
    expect(task?.why).toMatch(/bag and tag/i);
    expect(task?.caveat).toMatch(/manual is the only authority/i);
    // Deadlines that FIRST re-sets every season carry an explicit caveat.
    expect(taskById("register-team")?.caveat).toMatch(/firstinspires\.org/i);
    expect(KICKOFF_ACCURACY_NOTE).toMatch(/confirm them on firstinspires\.org/i);
  });
});

describe("date arithmetic", () => {
  it("parses and rejects ISO dates", () => {
    expect(parseIsoDate("2027-01-09")).toBe(Date.parse("2027-01-09T00:00:00.000Z"));
    expect(parseIsoDate("2027-02-30")).toBeNull();
    expect(parseIsoDate("not-a-date")).toBeNull();
    expect(parseIsoDate("2027-1-9")).toBeNull();
    expect(parseIsoDate(null)).toBeNull();
  });

  it("adds days across months, years, and leap days", () => {
    expect(addDays("2027-01-09", 42)).toBe("2027-02-20");
    expect(addDays("2027-01-09", -120)).toBe("2026-09-11");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2023-02-28", 1)).toBe("2023-03-01");
    expect(addDays("nope", 3)).toBeNull();
  });

  it("measures whole days between dates", () => {
    expect(daysBetween("2027-01-09", "2027-02-20")).toBe(42);
    expect(daysBetween("2027-02-20", "2027-01-09")).toBe(-42);
    expect(daysBetween("2027-01-09", "bad")).toBeNull();
  });

  it("dates a window from the team's own kickoff", () => {
    expect(windowDates({ startDay: 0, endDay: 6 }, KICKOFF)).toEqual({
      start: "2027-01-09",
      end: "2027-01-15",
    });
    expect(windowDates({ startDay: -150, endDay: -60 }, "garbage")).toBeNull();
  });

  it("describes a window in words even with no kickoff date", () => {
    expect(describeWindow({ startDay: 0, endDay: 0 })).toBe("Kickoff day");
    expect(describeWindow({ startDay: 0, endDay: 3 })).toBe("Kickoff weekend");
    expect(describeWindow({ startDay: 14, endDay: 20 })).toBe("Week 3 after kickoff");
    expect(describeWindow({ startDay: 14, endDay: 24 })).toBe("Weeks 3–4 after kickoff");
    expect(describeWindow({ startDay: -150, endDay: -60 })).toMatch(/before kickoff/);
  });
});

describe("urgency", () => {
  const task = taskById("driving-chassis")!; // days 14..21

  it("marks a passed window overdue and an open one due now", () => {
    expect(taskUrgency(task, { kickoffDate: KICKOFF, today: "2027-02-01", status: "todo" })).toBe(
      "overdue",
    );
    expect(taskUrgency(task, { kickoffDate: KICKOFF, today: "2027-01-25", status: "todo" })).toBe(
      "now",
    );
    expect(taskUrgency(task, { kickoffDate: KICKOFF, today: "2027-01-15", status: "todo" })).toBe(
      "soon",
    );
    expect(taskUrgency(task, { kickoffDate: KICKOFF, today: "2026-11-01", status: "todo" })).toBe(
      "later",
    );
  });

  it("never claims a date when the team has not given us one", () => {
    expect(taskUrgency(task, { kickoffDate: null, today: "2027-02-01", status: "todo" })).toBe(
      "undated",
    );
  });

  it("lets a recorded status win over the calendar", () => {
    expect(taskUrgency(task, { kickoffDate: KICKOFF, today: "2027-02-01", status: "done" })).toBe(
      "done",
    );
    expect(taskUrgency(task, { kickoffDate: KICKOFF, today: "2027-02-01", status: "skipped" })).toBe(
      "skipped",
    );
  });
});

describe("buildRoadmap", () => {
  it("is honest before a kickoff date is set", () => {
    const view = buildRoadmap({ kickoffDate: null, today: "2026-11-01" });
    expect(view.kickoffDate).toBeNull();
    for (const phase of view.phases) {
      expect(phase.dates).toBeNull();
      for (const task of phase.tasks) {
        expect(task.dates).toBeNull();
        expect(task.urgency).toBe("undated");
        expect(task.whenLabel.length).toBeGreaterThan(3);
      }
    }
    expect(view.summary.overdue).toBe(0);
  });

  it("treats a malformed kickoff date as no kickoff date", () => {
    const view = buildRoadmap({ kickoffDate: "2027-13-45", today: "2026-11-01" });
    expect(view.kickoffDate).toBeNull();
  });

  it("dates every task once a kickoff is entered", () => {
    const view = buildRoadmap({ kickoffDate: KICKOFF, today: "2027-01-20" });
    const chassis = view.phases
      .flatMap((phase) => phase.tasks)
      .find((task) => task.id === "driving-chassis");
    expect(chassis?.dates).toEqual({ start: "2027-01-23", end: "2027-01-30" });
    expect(view.summary.total).toBe(ROADMAP_TASKS.length);
  });

  it("shows only rookie-critical work in rookie mode", () => {
    const rookie = buildRoadmap({ kickoffDate: KICKOFF, today: "2027-01-20", rookieOnly: true });
    const all = rookie.phases.flatMap((phase) => phase.tasks);
    expect(all.every((task) => task.isRookieCritical)).toBe(true);
    expect(all.length).toBeLessThan(ROADMAP_TASKS.length);
    expect(rookie.rookieOnly).toBe(true);
  });

  it("applies stored progress and ignores rows for tasks that no longer exist", () => {
    const view = buildRoadmap({
      kickoffDate: KICKOFF,
      today: "2027-01-20",
      progress: [
        {
          taskId: "register-team",
          status: "done",
          note: "paid in September",
          completedByName: "Dana",
          completedAt: "2026-09-20T00:00:00.000Z",
        },
        { taskId: "field-elements", status: "skipped", note: null, completedByName: null, completedAt: null },
        { taskId: "a-task-we-deleted", status: "done", note: null, completedByName: null, completedAt: null },
      ],
    });
    const tasks = view.phases.flatMap((phase) => phase.tasks);
    const registered = tasks.find((task) => task.id === "register-team")!;
    expect(registered.status).toBe("done");
    expect(registered.note).toBe("paid in September");
    expect(registered.completedByName).toBe("Dana");
    expect(view.summary.done).toBe(1);
    expect(view.summary.skipped).toBe(1);
    // Skipped work is excluded from the denominator, not counted as failure.
    expect(view.summary.percentComplete).toBe(
      Math.round((1 / (ROADMAP_TASKS.length - 1)) * 100),
    );
  });

  it("answers 'what is due next' with overdue work first", () => {
    const view = buildRoadmap({ kickoffDate: KICKOFF, today: "2027-02-10", dueNextLimit: 4 });
    expect(view.dueNext).toHaveLength(4);
    expect(view.dueNext[0]?.urgency).toBe("overdue");
    const ranks = view.dueNext.map((task) => task.urgency);
    // Never regresses: overdue before now before soon before later.
    const order = ["overdue", "now", "soon", "later", "undated"];
    for (let i = 1; i < ranks.length; i += 1) {
      expect(order.indexOf(ranks[i]!)).toBeGreaterThanOrEqual(order.indexOf(ranks[i - 1]!));
    }
  });

  it("never puts finished or skipped work in what's-due-next", () => {
    const progress = ROADMAP_TASKS.slice(0, 5).map((task) => ({
      taskId: task.id,
      status: "done" as const,
      note: null,
      completedByName: null,
      completedAt: null,
    }));
    const view = buildRoadmap({ kickoffDate: KICKOFF, today: "2027-02-10", progress });
    const doneIds = new Set(progress.map((row) => row.taskId));
    for (const task of view.dueNext) expect(doneIds.has(task.id)).toBe(false);
  });

  it("is deterministic", () => {
    const a = buildRoadmap({ kickoffDate: KICKOFF, today: "2027-01-20" });
    const b = buildRoadmap({ kickoffDate: KICKOFF, today: "2027-01-20" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("rookie detection", () => {
  it("reads rookie status from teams_ref.rookie_year and admits when it cannot", () => {
    expect(isRookieByYear(2027, 2027)).toBe(true);
    expect(isRookieByYear(2026, 2027)).toBe(true);
    expect(isRookieByYear(2018, 2027)).toBe(false);
    expect(isRookieByYear(null, 2027)).toBeNull();
    expect(isRookieByYear(undefined, 2027)).toBeNull();
    expect(isRookieByYear(1800, 2027)).toBeNull();
    expect(isRookieByYear(2099, 2027)).toBeNull();
  });

  it("derives the season year from the kickoff date, or the autumn rollover", () => {
    expect(seasonYearForKickoff("2027-01-09", "2026-10-01")).toBe(2027);
    expect(seasonYearForKickoff(null, "2026-10-01")).toBe(2027);
    expect(seasonYearForKickoff(null, "2027-03-01")).toBe(2027);
  });

  it("validates stored statuses", () => {
    expect(isTaskStatus("done")).toBe(true);
    expect(isTaskStatus("nope")).toBe(false);
    expect(isTaskStatus(3)).toBe(false);
  });
});
