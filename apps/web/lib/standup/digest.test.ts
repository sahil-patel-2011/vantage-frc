import { describe, expect, it } from "vitest";
import { fromBuildTask, fromTodo } from "../work-items/canonical";
import type { WorkItem } from "../work-items/types";
import {
  buildHoursSummary,
  classifyMovement,
  compileDigest,
  defaultDigestDate,
  digestHasWork,
  digestHeadline,
  inWindow,
  standingBlockers,
  windowForDate,
} from "./digest";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DATE = "2026-02-10";
const { windowStart, windowEnd } = windowForDate(DATE);

const roster = [{ userId: "u-ada", name: "Ada" }];

function todo(over: Partial<Parameters<typeof fromTodo>[0]> = {}): WorkItem {
  return fromTodo(
    {
      id: "todo-1",
      title: "Wire the elevator",
      status: "todo",
      dueOn: null,
      assigneeUserId: "u-ada",
      assigneeName: "Ada",
      subteamId: null,
      subteamName: "electrical",
      createdAt: "2026-02-08T12:00:00.000Z",
      completedAt: null,
      ...over,
    },
    ORG,
    DATE,
  );
}

function task(over: Partial<Parameters<typeof fromBuildTask>[0]> = {}): WorkItem {
  return fromBuildTask(
    {
      id: "task-1",
      title: "Machine gearbox plate",
      status: "todo",
      dueOn: null,
      assignees: ["Ada"],
      subsystem: "drivetrain",
      createdAt: "2026-02-08T12:00:00.000Z",
      doneAt: null,
      ...over,
    },
    ORG,
    DATE,
    roster,
  );
}

describe("windowForDate / defaultDigestDate", () => {
  it("uses a UTC [start, next-day) window", () => {
    expect(windowForDate(DATE)).toEqual({
      windowStart: "2026-02-10T00:00:00.000Z",
      windowEnd: "2026-02-11T00:00:00.000Z",
    });
  });

  it("defaults to yesterday UTC", () => {
    expect(defaultDigestDate(new Date("2026-02-11T03:00:00.000Z"))).toBe("2026-02-10");
  });
});

describe("inWindow", () => {
  it("accepts postgres-style timestamps, not only ISO", () => {
    expect(inWindow("2026-02-10 15:00:00+00", windowStart, windowEnd)).toBe(true);
    expect(inWindow("2026-02-09T23:59:59.000Z", windowStart, windowEnd)).toBe(false);
    expect(inWindow("2026-02-11T00:00:00.000Z", windowStart, windowEnd)).toBe(false);
    expect(inWindow(null, windowStart, windowEnd)).toBe(false);
  });
});

describe("buildHoursSummary", () => {
  it("drops zero and non-finite hours so open or broken rows cannot invent time", () => {
    const summary = buildHoursSummary([
      { userId: "u1", name: "Ada", kind: "build", hours: 2.25 },
      { userId: "u1", name: "Ada", kind: "meeting", hours: 0.75 },
      { userId: "u2", name: "Grace", kind: "build", hours: 0 },
      { userId: "u3", name: "Bad", kind: "build", hours: Number.NaN },
    ]);
    expect(summary.totalHours).toBe(3);
    expect(summary.byKind).toEqual([
      { kind: "build", hours: 2.3 },
      { kind: "meeting", hours: 0.8 },
    ]);
    expect(summary.contributors.map((row) => row.userId)).toEqual(["u1"]);
  });
});

describe("classifyMovement", () => {
  it("is empty when nothing moved in the window", () => {
    expect(classifyMovement([todo(), task()], windowStart, windowEnd)).toEqual([]);
  });

  it("prefers completed over created when both land in the window", () => {
    const items = [
      todo({
        id: "done-1",
        status: "done",
        createdAt: "2026-02-10T09:00:00.000Z",
        completedAt: "2026-02-10T16:00:00.000Z",
      }),
    ];
    const movement = classifyMovement(items, windowStart, windowEnd);
    expect(movement).toHaveLength(1);
    expect(movement[0]?.event).toBe("completed");
    expect(movement[0]?.occurredAt).toBe("2026-02-10T16:00:00.000Z");
  });

  it("marks a blocked item created in-window as blocked, not merely created", () => {
    const items = [task({ id: "blocked-1", status: "blocked", createdAt: "2026-02-10T11:00:00.000Z" })];
    const movement = classifyMovement(items, windowStart, windowEnd);
    expect(movement[0]?.event).toBe("blocked");
  });

  it("does not invent newly-blocked movement for a standing blocker", () => {
    const items = [task({ id: "old-block", status: "blocked", createdAt: "2026-01-01T00:00:00.000Z" })];
    expect(classifyMovement(items, windowStart, windowEnd)).toEqual([]);
  });
});

describe("standingBlockers", () => {
  it("lists currently blocked work with age from createdAt", () => {
    const items = [
      task({ id: "old-block", status: "blocked", createdAt: "2026-02-08T00:00:00.000Z" }),
      todo({ id: "open", status: "doing" }),
    ];
    const blockers = standingBlockers(items, new Date("2026-02-10T12:00:00.000Z"));
    expect(blockers).toHaveLength(1);
    expect(blockers[0]?.id).toBe("old-block");
    expect(blockers[0]?.ageDays).toBe(2);
  });
});

describe("digestHasWork / digestHeadline / compileDigest", () => {
  it("stays empty — no headline — when the day has no hours and no movement", () => {
    const digest = compileDigest({
      digestDate: DATE,
      items: [todo(), task({ id: "old-block", status: "blocked", createdAt: "2026-01-01T00:00:00.000Z" })],
      hourRows: [],
    });
    expect(digestHasWork(digest)).toBe(false);
    expect(digest.headline).toBeNull();
    expect(digest.movement).toEqual([]);
    expect(digest.blockers).toHaveLength(1);
  });

  it("compiles a live digest from closed hours and completed work only", () => {
    const digest = compileDigest({
      digestDate: DATE,
      items: [
        todo({
          id: "done-1",
          status: "done",
          completedAt: "2026-02-10T16:00:00.000Z",
        }),
        todo({ id: "open", status: "doing" }),
      ],
      hourRows: [
        { userId: "u-ada", name: "Ada", kind: "build", hours: 3.5 },
        { userId: "u-grace", name: "Grace", kind: "outreach", hours: 1 },
      ],
    });
    expect(digestHasWork(digest)).toBe(true);
    expect(digest.hours.totalHours).toBe(4.5);
    expect(digest.movement).toHaveLength(1);
    expect(digest.movement[0]?.event).toBe("completed");
    expect(digest.headline).toBe("2026-02-10: 4.5h logged · 1 completed");
  });

  it("omits zero segments from the headline", () => {
    expect(
      digestHeadline({
        digestDate: DATE,
        hours: { totalHours: 2, byKind: [], contributors: [] },
        movement: [],
      }),
    ).toBe("2026-02-10: 2h logged");
  });
});
