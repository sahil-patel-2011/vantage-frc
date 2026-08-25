import { describe, expect, it } from "vitest";
import { emptyDreamDigest } from "./compute-dream";
import {
  digestSourceCounts,
  errorStreak,
  errorStreakChecklist,
  formatJournalDay,
  journalEntryTitle,
  parseSourceCounts,
  retentionNotice,
  sourceChips,
  statusLine,
  sumSourceCounts,
  type DreamJournalEntry,
} from "./journal";

function entry(overrides: Partial<DreamJournalEntry> = {}): DreamJournalEntry {
  return {
    day: "2026-08-22",
    kind: "daily",
    status: "ok",
    ranAt: "2026-08-23T04:15:00.000Z",
    content: "Team recap.",
    memoryLive: true,
    errorClass: null,
    tokensIn: 900,
    tokensOut: 210,
    sourceCounts: {},
    ...overrides,
  };
}

describe("digestSourceCounts", () => {
  it("omits every source that recorded nothing", () => {
    expect(digestSourceCounts(emptyDreamDigest("Team", "2026-08-22"))).toEqual({});
  });

  it("snapshots the counts a digest actually produced", () => {
    const digest = emptyDreamDigest("Team", "2026-08-22");
    digest.messages.count = 12;
    digest.scouting.total = 40;
    digest.tasksCompleted.count = 3;
    digest.incidents.openedCount = 1;
    digest.incidents.resolvedCount = 2;
    digest.hours.totalHours = 6.24;
    digest.matchResults.items.push({
      matchLabel: "qm1",
      ourAlliance: "red",
      ourScore: 10,
      theirScore: 9,
      outcome: "win",
    });
    expect(digestSourceCounts(digest)).toEqual({
      messages: 12,
      scouting: 40,
      tasks: 3,
      incidents: 3,
      hours: 6.2,
      matches: 1,
    });
  });
});

describe("sumSourceCounts / parseSourceCounts", () => {
  it("adds several days and keeps hours to one decimal", () => {
    expect(sumSourceCounts([{ messages: 2, hours: 1.15 }, { messages: 3, hours: 2.2 }, null])).toEqual({
      messages: 5,
      hours: 3.4,
    });
  });

  it("drops unknown keys and non-positive numbers from untrusted jsonb", () => {
    expect(
      parseSourceCounts({ messages: 4, bogus: 9, tasks: 0, scouting: "12", hours: -3 }),
    ).toEqual({ messages: 4 });
    expect(parseSourceCounts(null)).toEqual({});
    expect(parseSourceCounts([1, 2])).toEqual({});
  });
});

describe("sourceChips", () => {
  it("renders one chip per contributing source, singular-aware", () => {
    expect(sourceChips({ messages: 1, scouting: 2, tasks: 1 })).toEqual([
      { id: "messages", label: "1 message" },
      { id: "scouting", label: "2 scout entries" },
      { id: "tasks", label: "1 task done" },
    ]);
  });

  it("formats hours as a decimal, not a count", () => {
    expect(sourceChips({ hours: 6.25 })).toEqual([{ id: "hours", label: "6.3 hours logged" }]);
    expect(sourceChips({ hours: 1 })).toEqual([{ id: "hours", label: "1 hour logged" }]);
  });

  it("renders no chips at all for an empty snapshot", () => {
    expect(sourceChips({})).toEqual([]);
    expect(sourceChips(null)).toEqual([]);
  });
});

describe("formatJournalDay / journalEntryTitle", () => {
  it("names the weekday in UTC", () => {
    expect(formatJournalDay("2026-08-22")).toContain("Saturday");
  });

  it("labels a weekly roll-up as a week ending", () => {
    expect(journalEntryTitle(entry({ kind: "weekly" }))).toContain("Week ending");
    expect(journalEntryTitle(entry())).not.toContain("Week ending");
  });

  it("returns a malformed day unchanged rather than rendering Invalid Date", () => {
    expect(formatJournalDay("nope")).toBe("nope");
  });
});

describe("statusLine", () => {
  it("says nothing for a successful day — the content speaks for itself", () => {
    expect(statusLine(entry())).toBeNull();
  });

  it("explains a quiet day and a skipped week differently", () => {
    expect(statusLine(entry({ status: "no_activity" }))).toContain("No recorded activity");
    expect(statusLine(entry({ status: "no_activity", kind: "weekly" }))).toContain(
      "Not enough daily entries",
    );
  });

  it("names the recorded error class on a failed run", () => {
    expect(statusLine(entry({ status: "error", errorClass: "BudgetExceeded" }))).toContain(
      "BudgetExceeded",
    );
    expect(statusLine(entry({ status: "error", errorClass: null }))).toContain("The run failed.");
  });

  it("flags the no-AI fallback as facts-only", () => {
    expect(statusLine(entry({ status: "no_ai_fallback" }))).toContain("No AI summary available");
  });
});

describe("errorStreak", () => {
  it("is null for a single bad night — one failure is not a streak", () => {
    expect(errorStreak([entry({ status: "error" }), entry({ day: "2026-08-21" })])).toBeNull();
  });

  it("counts consecutive failures from the newest entry", () => {
    const streak = errorStreak([
      entry({ day: "2026-08-22", status: "error", errorClass: "AuthError" }),
      entry({ day: "2026-08-21", status: "error", errorClass: "AuthError" }),
      entry({ day: "2026-08-20", status: "error", errorClass: "AuthError" }),
      entry({ day: "2026-08-19", status: "ok" }),
    ]);
    expect(streak).toEqual({
      count: 3,
      errorClass: "AuthError",
      since: "2026-08-20",
      latest: "2026-08-22",
    });
  });

  it("ignores weekly rows so they cannot split a daily streak", () => {
    const streak = errorStreak([
      entry({ day: "2026-08-22", kind: "weekly", status: "no_activity" }),
      entry({ day: "2026-08-22", status: "error", errorClass: "HttpError" }),
      entry({ day: "2026-08-21", status: "error", errorClass: "HttpError" }),
    ]);
    expect(streak?.count).toBe(2);
    expect(streak?.errorClass).toBe("HttpError");
  });

  it("stops at the first healthy night", () => {
    expect(
      errorStreak([entry({ day: "2026-08-22", status: "ok" }), entry({ day: "2026-08-21", status: "error" })]),
    ).toBeNull();
  });
});

describe("errorStreakChecklist", () => {
  it("leads with the budget cap when the error class is about billing", () => {
    expect(errorStreakChecklist("BudgetExceededError")[0]).toContain("budget cap");
  });

  it("short-circuits to membership when the org has no members", () => {
    const checks = errorStreakChecklist("NoOrgMembers");
    expect(checks).toHaveLength(1);
    expect(checks[0]).toContain("no members");
  });

  it("always offers the key check when the class is unknown", () => {
    expect(errorStreakChecklist(null).join(" ")).toContain("API keys");
  });
});

describe("retentionNotice", () => {
  it("states the team's real retention window", () => {
    expect(retentionNotice(365)).toContain("365 days");
    expect(retentionNotice(1)).toContain("1 day");
  });

  it("never renders zero or a fraction of a day", () => {
    expect(retentionNotice(0)).toContain("1 day");
    expect(retentionNotice(30.4)).toContain("30 days");
  });
});
