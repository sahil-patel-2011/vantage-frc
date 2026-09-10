import { describe, expect, it } from "vitest";
import { PACKING_TEMPLATE } from "../packing";
import {
  EMPTY_AVAILABILITY,
  MY_KIT_SECTION_IDS,
  TONIGHT_EMPTY_LABEL,
  composeMyKit,
  dayKeyUtc,
  deriveFocus,
  dueTone,
  focusLabel,
  focusLinks,
  formatHours,
  formatWhen,
  isDueByTonight,
  isOnTonight,
  minutesBetween,
  myKitSetupRequired,
  sectionOrder,
  statusLabel,
  summarizeHours,
  toInstant,
  trackKeysFor,
} from "./compose";
import type { MyKitAvailability, MyKitComposeInput, MyKitSectionId } from "./types";

const ORG = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-03-04T18:00:00.000Z";

const ALL_AVAILABLE: MyKitAvailability = MY_KIT_SECTION_IDS.reduce(
  (acc, id) => ({ ...acc, [id]: true }),
  { ...EMPTY_AVAILABILITY },
);

function input(overrides: Partial<MyKitComposeInput> = {}): MyKitComposeInput {
  return {
    orgId: ORG,
    orgName: "Team Vantage",
    teamNumber: 9999,
    userId: USER,
    displayName: "Riley Chen",
    orgRole: "member",
    teamRole: "student",
    subteams: [],
    nowIso: NOW,
    availability: { ...ALL_AVAILABLE },
    tasks: [],
    events: [],
    duties: [],
    scoutAssignments: [],
    scoutAccuracy: null,
    media: [],
    hourLogs: [],
    learning: null,
    skills: [],
    certifications: [],
    tools: [],
    money: [],
    onboarding: [],
    packing: [],
    ...overrides,
  };
}

describe("time helpers", () => {
  it("reads a date-only value as the end of that UTC day", () => {
    expect(toInstant("2026-03-04")).toBe(new Date("2026-03-04T23:59:59.999Z").getTime());
  });

  it("returns null for junk instead of NaN", () => {
    expect(toInstant("not-a-date")).toBeNull();
    expect(toInstant("")).toBeNull();
    expect(toInstant(null)).toBeNull();
    expect(dayKeyUtc("nope")).toBeNull();
  });

  it("keeps a date-only day key verbatim", () => {
    expect(dayKeyUtc("2026-03-04")).toBe("2026-03-04");
    expect(dayKeyUtc("2026-03-04T23:30:00.000Z")).toBe("2026-03-04");
  });

  it("never returns negative minutes for an open or inverted session", () => {
    expect(minutesBetween("2026-03-04T10:00:00Z", null)).toBe(0);
    expect(minutesBetween("2026-03-04T10:00:00Z", "2026-03-04T09:00:00Z")).toBe(0);
    expect(minutesBetween("2026-03-04T10:00:00Z", "2026-03-04T12:30:00Z")).toBe(150);
  });

  it("formats UTC dates the same way in every timezone", () => {
    expect(formatWhen("2026-03-04T18:05:00.000Z")).toBe("Mar 4");
    expect(formatWhen("2026-03-04T18:05:00.000Z", { time: true })).toBe("Mar 4, 6:05 PM");
    expect(formatWhen("2026-03-04T00:05:00.000Z", { time: true })).toBe("Mar 4, 12:05 AM");
    expect(formatWhen(null)).toBe("");
  });
});

describe("tonight windows", () => {
  it("flags due-by-tonight without guessing undated work", () => {
    expect(isDueByTonight(null, NOW)).toBe(false);
    expect(isDueByTonight("2026-03-04", NOW)).toBe(true);
    expect(isDueByTonight("2026-03-01T10:00:00Z", NOW)).toBe(true);
    expect(isDueByTonight("2026-03-20", NOW)).toBe(false);
  });

  it("flags on-tonight only for the same UTC day", () => {
    expect(isOnTonight("2026-03-04T22:00:00Z", NOW)).toBe(true);
    expect(isOnTonight("2026-03-03T22:00:00Z", NOW)).toBe(false);
    expect(isOnTonight(null, NOW)).toBe(false);
  });
});

describe("dueTone", () => {
  it("is neutral when there is no due value — never a guess", () => {
    expect(dueTone(null, NOW)).toBe("neutral");
    expect(dueTone("", NOW)).toBe("neutral");
  });

  it("flags past due as overdue and the next 72h as due", () => {
    expect(dueTone("2026-03-01T10:00:00Z", NOW)).toBe("overdue");
    expect(dueTone("2026-03-05T10:00:00Z", NOW)).toBe("due");
    expect(dueTone("2026-03-20T10:00:00Z", NOW)).toBe("neutral");
  });
});

describe("summarizeHours", () => {
  it("is honestly empty with no logs", () => {
    expect(summarizeHours([], NOW)).toEqual({
      totalMinutes: 0,
      sessionCount: 0,
      streakDays: 0,
      lastLoggedOn: null,
      openSession: false,
    });
  });

  it("totals closed sessions and marks an open clock-in", () => {
    const hours = summarizeHours(
      [
        { id: "a", kind: "build", clockIn: "2026-03-04T16:00:00Z", clockOut: null },
        { id: "b", kind: "build", clockIn: "2026-03-03T16:00:00Z", clockOut: "2026-03-03T19:00:00Z" },
      ],
      NOW,
    );
    expect(hours.totalMinutes).toBe(180);
    expect(hours.sessionCount).toBe(2);
    expect(hours.openSession).toBe(true);
    expect(hours.lastLoggedOn).toBe("2026-03-04");
  });

  it("counts consecutive UTC days, ignoring two logs on one day", () => {
    const hours = summarizeHours(
      [
        { id: "a", kind: "build", clockIn: "2026-03-04T16:00:00Z", clockOut: "2026-03-04T18:00:00Z" },
        { id: "b", kind: "build", clockIn: "2026-03-04T19:00:00Z", clockOut: "2026-03-04T20:00:00Z" },
        { id: "c", kind: "build", clockIn: "2026-03-03T16:00:00Z", clockOut: "2026-03-03T18:00:00Z" },
        { id: "d", kind: "build", clockIn: "2026-03-02T16:00:00Z", clockOut: "2026-03-02T18:00:00Z" },
      ],
      NOW,
    );
    expect(hours.streakDays).toBe(3);
  });

  it("still counts a streak that ended yesterday", () => {
    const hours = summarizeHours(
      [
        { id: "a", kind: "build", clockIn: "2026-03-03T16:00:00Z", clockOut: "2026-03-03T18:00:00Z" },
        { id: "b", kind: "build", clockIn: "2026-03-02T16:00:00Z", clockOut: "2026-03-02T18:00:00Z" },
      ],
      NOW,
    );
    expect(hours.streakDays).toBe(2);
  });

  it("reports zero for a stale streak instead of a flattering number", () => {
    const hours = summarizeHours(
      [
        { id: "a", kind: "build", clockIn: "2026-01-10T16:00:00Z", clockOut: "2026-01-10T18:00:00Z" },
        { id: "b", kind: "build", clockIn: "2026-01-09T16:00:00Z", clockOut: "2026-01-09T18:00:00Z" },
      ],
      NOW,
    );
    expect(hours.streakDays).toBe(0);
    expect(hours.lastLoggedOn).toBe("2026-01-10");
  });

  it("breaks the streak on a gap day", () => {
    const hours = summarizeHours(
      [
        { id: "a", kind: "build", clockIn: "2026-03-04T16:00:00Z", clockOut: "2026-03-04T18:00:00Z" },
        { id: "b", kind: "build", clockIn: "2026-03-01T16:00:00Z", clockOut: "2026-03-01T18:00:00Z" },
      ],
      NOW,
    );
    expect(hours.streakDays).toBe(1);
  });

  it("formats hours to one decimal", () => {
    expect(formatHours(150)).toBe("2.5h");
    expect(formatHours(0)).toBe("0h");
  });
});

describe("deriveFocus", () => {
  it("prefers media over the business track the shared keyword map would pick", () => {
    expect(deriveFocus(["Media & Marketing"])).toBe("media");
    expect(deriveFocus(["Business"])).toBe("business");
  });

  it("maps common subteam names through the role-onboarding keyword map", () => {
    expect(deriveFocus(["Scouting"])).toBe("scouting");
    expect(deriveFocus(["Electrical"])).toBe("electrical");
    expect(deriveFocus(["Programming"])).toBe("programming");
    expect(deriveFocus(["CAD / Design"])).toBe("cad");
    expect(deriveFocus(["Drive Team"])).toBe("drive_team");
    expect(deriveFocus(["Safety"])).toBe("safety");
  });

  it("falls back to the whole-team lens when nothing matches", () => {
    expect(deriveFocus([])).toBe("general");
    expect(deriveFocus(["Bagels"])).toBe("general");
    expect(focusLabel("general")).toBe("Whole team");
  });

  it("exposes the matched onboarding track keys", () => {
    expect(trackKeysFor(["Scouting", "Electrical"])).toEqual(["scouting", "electrical"]);
    expect(trackKeysFor([])).toEqual([]);
  });
});

describe("sectionOrder", () => {
  it("keeps every section exactly once for every focus", () => {
    for (const focus of [
      "scouting",
      "media",
      "electrical",
      "programming",
      "mechanical",
      "cad",
      "drive_team",
      "business",
      "safety",
      "general",
    ] as const) {
      const order = sectionOrder(focus);
      expect(new Set(order).size).toBe(MY_KIT_SECTION_IDS.length);
      expect([...order].sort()).toEqual([...MY_KIT_SECTION_IDS].sort());
    }
  });

  it("leads with assignments for a scout and content for a media member", () => {
    expect(sectionOrder("scouting")[0]).toBe("scouting");
    expect(sectionOrder("media")[0]).toBe("media");
    expect(sectionOrder("general")[0]).toBe("tasks");
  });
});

describe("focusLinks", () => {
  it("gives an electrical member wiring and power links, org-scoped", () => {
    const links = focusLinks("electrical", ORG);
    expect(links.map((link) => link.id)).toEqual([
      "wiring",
      "control-map",
      "power-budget",
      "batteries",
    ]);
    expect(links[0]!.href).toContain(`orgId=${ORG}`);
  });

  it("omits the org param when there is no org", () => {
    expect(focusLinks("general", null)[0]!.href).toBe("/team");
  });
});

describe("composeMyKit", () => {
  it("produces every section, all honestly empty, for a brand-new member", () => {
    const view = composeMyKit(input());
    expect(view.status).toBe("live");
    expect(view.sections).toHaveLength(MY_KIT_SECTION_IDS.length);
    expect(view.sections.every((section) => section.rows.length === 0)).toBe(true);
    expect(view.actionableCount).toBe(0);
    expect(view.unavailableSections).toEqual([]);
    expect(view.person.focus).toBe("general");
  });

  it("says 'not on this deployment' rather than 'you have none' for a missing table", () => {
    const view = composeMyKit(
      input({
        availability: { ...ALL_AVAILABLE, tools: false },
        tools: [{ id: "t1", toolName: "Rivet gun", checkedOutAt: NOW, dueAt: null }],
      }),
    );
    const tools = view.sections.find((section) => section.id === "tools")!;
    expect(tools.available).toBe(false);
    // Rows from a table we cannot trust are dropped, not rendered.
    expect(tools.rows).toEqual([]);
    expect(tools.emptyLabel).toContain("does not have this feature's tables");
    expect(view.unavailableSections).toEqual(["tools"]);
  });

  it("links every row to the surface that owns the record", () => {
    const view = composeMyKit(
      input({
        tasks: [
          {
            id: "bt1",
            source: "build_task",
            title: "Mount the intake",
            status: "in_progress",
            context: "intake",
            dueOn: "2026-03-01",
            priority: "high",
          },
          {
            id: "td1",
            source: "todo",
            title: "Order bumper fabric",
            status: "todo",
            context: "Business",
            dueOn: null,
            priority: null,
          },
        ],
      }),
    );
    const tasks = view.sections.find((section) => section.id === "tasks")!;
    expect(tasks.rows[0]!.href).toContain("/tasks");
    expect(tasks.rows[1]!.href).toContain("/todos");
    expect(tasks.rows[0]!.tone).toBe("overdue");
    expect(tasks.rows[0]!.detail).toBe("Build task · intake · high priority");
    expect(tasks.rows[1]!.meta).toBe("To do");
    expect(tasks.actionable).toBe(1);
  });

  it("puts a scout's assignments first and appends accuracy only when scored", () => {
    const view = composeMyKit(
      input({
        subteams: [{ id: "s1", name: "Scouting" }],
        scoutAssignments: [
          {
            id: "sa1",
            eventKey: "2026week1",
            matchKey: "2026week1_qm12",
            teamKey: "frc9999",
            role: "primary",
            startsAt: "2026-03-04T19:00:00Z",
          },
        ],
        scoutAccuracy: {
          eventKey: "2026week1",
          entriesScored: 24,
          accuracyScore: 91.4,
          rank: 2,
          scoutsScored: 11,
          computedAt: "2026-03-04T12:00:00Z",
        },
      }),
    );
    expect(view.sections[0]!.id).toBe("scouting");
    expect(view.sections[0]!.emphasis).toBe(true);
    expect(view.sections[0]!.reason).toContain("Scouting is your subteam");
    expect(view.sections[0]!.rows.map((row) => row.id)).toEqual([
      "scout:sa1",
      "scout-accuracy",
    ]);
    expect(view.sections[0]!.rows[1]!.title).toBe("Accuracy 91%");
    expect(view.sections[0]!.rows[1]!.detail).toContain("Rank 2 of 11");
  });

  it("omits the accuracy row entirely when the scout has not been scored", () => {
    const view = composeMyKit(
      input({
        subteams: [{ id: "s1", name: "Scouting" }],
        scoutAssignments: [
          {
            id: "sa1",
            eventKey: "2026week1",
            matchKey: "2026week1_qm12",
            teamKey: "frc9999",
            role: "primary",
            startsAt: null,
          },
        ],
      }),
    );
    const scouting = view.sections.find((section) => section.id === "scouting")!;
    expect(scouting.rows).toHaveLength(1);
    expect(scouting.rows[0]!.meta).toBe("");
  });

  it("leads a media member with content deadlines and flags overdue ones", () => {
    const view = composeMyKit(
      input({
        subteams: [{ id: "s1", name: "Media" }],
        media: [
          {
            id: "m1",
            title: "Week 1 recap reel",
            platform: "instagram",
            status: "draft",
            dueAt: "2026-03-02T12:00:00Z",
          },
        ],
      }),
    );
    expect(view.sections[0]!.id).toBe("media");
    expect(view.sections[0]!.rows[0]!.tone).toBe("overdue");
    expect(view.person.focus).toBe("media");
    expect(view.quickLinks.map((link) => link.id)).toContain("media-kit");
  });

  it("gives an electrical member wiring links and leads with open work", () => {
    const view = composeMyKit(input({ subteams: [{ id: "s1", name: "Electrical" }] }));
    expect(view.sections[0]!.id).toBe("tasks");
    expect(view.quickLinks.map((link) => link.id)).toEqual([
      "wiring",
      "control-map",
      "power-budget",
      "batteries",
    ]);
    expect(view.person.trackKeys).toEqual(["electrical"]);
  });

  it("marks an upcoming calendar item as due and an in-progress one as info", () => {
    const view = composeMyKit(
      input({
        events: [
          {
            id: "e1",
            title: "Build night",
            kind: "build",
            startsAt: "2026-03-04T22:00:00Z",
            location: "Shop",
            subteamName: "",
            rsvp: "going",
          },
          {
            id: "e2",
            title: "Started already",
            kind: "meeting",
            startsAt: "2026-03-04T17:00:00Z",
            location: "",
            subteamName: "Programming",
            rsvp: null,
          },
        ],
      }),
    );
    const calendar = view.sections.find((section) => section.id === "calendar")!;
    expect(calendar.rows[0]!.tone).toBe("due");
    expect(calendar.rows[0]!.detail).toBe("Whole team · Shop · You said going");
    expect(calendar.rows[1]!.tone).toBe("info");
  });

  it("surfaces an expired certification distinctly from a current one", () => {
    const view = composeMyKit(
      input({
        certifications: [
          { id: "c1", certType: "power_tools", completedOn: "2025-09-01", expiresOn: "2026-01-01" },
          { id: "c2", certType: "first_aid", completedOn: "2026-01-05", expiresOn: null },
        ],
        skills: [{ id: "sk1", label: "drivetrain", proficiency: "proficient" }],
      }),
    );
    const skills = view.sections.find((section) => section.id === "skills")!;
    expect(skills.rows.map((row) => row.id)).toEqual(["skill:sk1", "cert:c1", "cert:c2"]);
    expect(skills.rows[1]!.tone).toBe("overdue");
    expect(skills.rows[1]!.meta).toContain("Expired");
    expect(skills.rows[2]!.tone).toBe("done");
    expect(skills.rows[2]!.meta).toBe("Certification");
  });

  it("summarizes the learning ledger only when there is something in it", () => {
    expect(
      composeMyKit(input({ learning: { total: 0, spotOn: 0, close: 0, off: 0, skipped: 0, lastAt: null } }))
        .sections.find((section) => section.id === "learning")!.rows,
    ).toEqual([]);

    const view = composeMyKit(
      input({
        learning: {
          total: 7,
          spotOn: 3,
          close: 2,
          off: 1,
          skipped: 1,
          lastAt: "2026-03-02T10:00:00Z",
        },
      }),
    );
    const learning = view.sections.find((section) => section.id === "learning")!;
    expect(learning.rows[0]!.title).toBe("7 calls logged");
    expect(learning.rows[0]!.detail).toBe("3 spot-on · 2 close · 1 off · 1 skipped");
  });

  it("keeps an open clock-in visible and shows only the five most recent sessions", () => {
    const logs = Array.from({ length: 8 }, (_, i) => ({
      id: `h${i}`,
      kind: "build",
      clockIn: `2026-03-0${(i % 4) + 1}T16:00:00Z`,
      clockOut: i === 0 ? null : `2026-03-0${(i % 4) + 1}T18:00:00Z`,
    }));
    const view = composeMyKit(input({ hourLogs: logs }));
    const hours = view.sections.find((section) => section.id === "hours")!;
    expect(hours.rows).toHaveLength(5);
    expect(hours.rows[0]!.detail).toBe("Still clocked in");
    expect(view.hours.openSession).toBe(true);
    expect(view.hours.sessionCount).toBe(8);
  });

  it("shows tool loans and money requests with their owning surfaces", () => {
    const view = composeMyKit(
      input({
        tools: [
          {
            id: "t1",
            toolName: "Torque wrench",
            checkedOutAt: "2026-03-01T12:00:00Z",
            dueAt: "2026-03-02T12:00:00Z",
          },
        ],
        money: [
          {
            id: "p1",
            source: "purchase_request",
            title: "Falcon 500",
            status: "pending",
            amountUsd: 189.99,
            createdAt: "2026-03-01T12:00:00Z",
          },
          {
            id: "r1",
            source: "reimbursement",
            title: "Reimbursement request",
            status: "submitted",
            amountUsd: null,
            createdAt: null,
          },
        ],
      }),
    );
    const tools = view.sections.find((section) => section.id === "tools")!;
    expect(tools.rows[0]!.tone).toBe("overdue");
    expect(tools.rows[0]!.href).toContain("/tool-checkout");

    const money = view.sections.find((section) => section.id === "money")!;
    expect(money.rows[0]!.meta).toBe("Pending · $189.99");
    expect(money.rows[0]!.href).toContain("/orders");
    // No amount known for the parallel-wave reimbursement shape — we say nothing.
    expect(money.rows[1]!.meta).toBe("Submitted");
    expect(money.rows[1]!.href).toContain("/team/finance");
  });

  it("counts actionable rows across sections", () => {
    const view = composeMyKit(
      input({
        tasks: [
          {
            id: "bt1",
            source: "build_task",
            title: "Late thing",
            status: "todo",
            context: "",
            dueOn: "2026-03-01",
            priority: "normal",
          },
        ],
        tools: [
          { id: "t1", toolName: "Drill", checkedOutAt: "2026-03-01T12:00:00Z", dueAt: "2026-03-05T12:00:00Z" },
        ],
      }),
    );
    expect(view.actionableCount).toBe(2);
  });

  it("keeps section ids stable so the client can key on them", () => {
    const view = composeMyKit(input());
    const ids = view.sections.map((section) => section.id as MyKitSectionId);
    expect([...ids].sort()).toEqual([...MY_KIT_SECTION_IDS].sort());
  });

  it("tonight is honestly empty when this member has no assignments and no packing", () => {
    const view = composeMyKit(input());
    expect(view.tonight.rows).toEqual([]);
    expect(view.tonight.assignmentCount).toBe(0);
    expect(view.tonight.packingCount).toBe(0);
    expect(view.tonight.emptyLabel).toBe(TONIGHT_EMPTY_LABEL);
    expect(view.tonight.emptyLabel).not.toMatch(/DEMO/i);
    expect(view.tonight.emptyLabel).not.toMatch(/template kit/i);
    const packing = view.sections.find((section) => section.id === "packing")!;
    expect(packing.rows).toEqual([]);
    expect(packing.emptyLabel).toContain("not your kit");
    const blob = JSON.stringify(view);
    for (const label of PACKING_TEMPLATE.flatMap((group) => group.items.map((item) => item.label))) {
      expect(blob).not.toContain(label);
    }
  });

  it("tonight lists assigned work due today plus unpacked packing that belongs to this member", () => {
    const view = composeMyKit(
      input({
        tasks: [
          {
            id: "bt1",
            source: "build_task",
            title: "Charge batteries",
            status: "todo",
            context: "electrical",
            dueOn: "2026-03-04",
            priority: "high",
          },
          {
            id: "bt2",
            source: "build_task",
            title: "Order next week's shaft",
            status: "todo",
            context: "drivetrain",
            dueOn: "2026-03-20",
            priority: "normal",
          },
        ],
        packing: [
          {
            id: "pr1",
            source: "request",
            listId: "list1",
            listTitle: "Week 1 load-out",
            eventKey: "2026week1",
            category: "Batteries & Power",
            label: "My charged pack",
            quantity: 2,
            status: "pending",
            packed: false,
          },
          {
            id: "pk1",
            source: "packed",
            listId: "list1",
            listTitle: "Week 1 load-out",
            eventKey: "2026week1",
            category: "Tools & Pit",
            label: "My hex set",
            quantity: 1,
            status: "packed",
            packed: true,
          },
        ],
      }),
    );
    expect(view.tonight.assignmentCount).toBe(1);
    expect(view.tonight.packingCount).toBe(1);
    expect(view.tonight.rows.map((row) => row.title)).toEqual(["Charge batteries", "My charged pack"]);
    expect(view.tonight.rows[1]!.href).toContain("/packing");
    const packing = view.sections.find((section) => section.id === "packing")!;
    expect(packing.rows).toHaveLength(2);
    expect(packing.rows[0]!.tone).toBe("due");
    expect(packing.rows[1]!.tone).toBe("done");
    expect(packing.rows[0]!.detail).toContain("You requested this");
  });

  it("does not treat a teammate's packing row as this member's kit", () => {
    const view = composeMyKit(input());
    expect(view.tonight.rows).toEqual([]);
    expect(view.sections.find((section) => section.id === "packing")!.rows).toEqual([]);
  });
});

describe("misc", () => {
  it("humanizes statuses without inventing new ones", () => {
    expect(statusLabel("in_progress")).toBe("In progress");
    expect(statusLabel("weird_custom_state")).toBe("weird custom state");
  });

  it("offers a team step when there is no org", () => {
    const view = myKitSetupRequired(null);
    expect(view.status).toBe("setup_required");
    expect(view.steps[0]!.href).toBe("/workspace");
    expect(view.orgId).toBeNull();
  });
});
