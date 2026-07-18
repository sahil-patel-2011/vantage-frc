import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { computeMentorHoursView } from "./compute-mentor-hours";
import { computeMentorEngagement, summarizeMentorHours } from ".";
import type { MentorHoursEntry } from "./types";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeMentorHoursView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeMentorHoursView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view with summary and engagement over logged entries", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM mentor_hours_entries") && sql.includes("SELECT id")) {
        return {
          rows: [
            {
              id: "e1",
              mentorName: "Pat Mentor",
              mentorUserId: null,
              role: "professional_mentor",
              category: "build",
              occurredOn: "2026-01-10",
              durationMinutes: 180,
              seasonYear: 2026,
              notes: "Drivetrain assembly",
            },
            {
              id: "e2",
              mentorName: "Sam Alumni",
              mentorUserId: null,
              role: "alumni_mentor",
              category: "strategy",
              occurredOn: "2026-02-05",
              durationMinutes: 60,
              seasonYear: 2026,
              notes: null,
            },
          ],
        };
      }
      if (sql.includes("DISTINCT season_year")) {
        return { rows: [{ seasonYear: 2026 }] };
      }
      return { rows: [] };
    });

    const view = await computeMentorHoursView(client, { userId: USER, requestedOrg: ORG });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.orgId).toBe(ORG);
    expect(view.teamNumber).toBe(254);
    expect(view.entries).toHaveLength(2);
    expect(view.summary.totalEntries).toBe(2);
    expect(view.summary.totalHours).toBe(4);
    expect(view.summary.uniqueMentors).toBe(2);
    expect(view.engagement.score).toBeGreaterThan(0);
    expect(view.engagement.tier).toBeDefined();
  });
});

let seq = 0;
function entry(overrides: Partial<MentorHoursEntry> = {}): MentorHoursEntry {
  seq += 1;
  return {
    id: `entry-${seq}`,
    mentorName: `Mentor ${seq}`,
    mentorUserId: null,
    role: "mentor",
    category: "build",
    occurredOn: "2026-02-15",
    durationMinutes: 120,
    seasonYear: 2026,
    notes: null,
    ...overrides,
  };
}

describe("summarizeMentorHours", () => {
  it("returns an all-zero summary for no entries", () => {
    const s = summarizeMentorHours([]);
    expect(s.totalEntries).toBe(0);
    expect(s.totalHours).toBe(0);
    expect(s.uniqueMentors).toBe(0);
    expect(s.engagementSignal).toBe(0);
    expect(s.byCategory).toEqual([]);
  });

  it("aggregates minutes into hours and counts unique mentors case-insensitively", () => {
    const s = summarizeMentorHours([
      entry({ mentorName: "Pat Mentor", durationMinutes: 90 }),
      entry({ mentorName: "pat mentor", durationMinutes: 30 }),
      entry({ mentorName: "Sam Alumni", durationMinutes: 60 }),
    ]);
    expect(s.totalEntries).toBe(3);
    expect(s.totalMinutes).toBe(180);
    expect(s.totalHours).toBe(3);
    expect(s.uniqueMentors).toBe(2);
    expect(s.byMentor.find((m) => m.mentorName === "Pat Mentor")?.hours).toBe(2);
  });
});

describe("computeMentorEngagement", () => {
  it("is fully zero with an empty log and prompts a first entry", () => {
    const engagement = computeMentorEngagement(summarizeMentorHours([]));
    expect(engagement.score).toBe(0);
    expect(engagement.tier).toBe("emerging");
    expect(engagement.recommendations[0]).toMatch(/first mentor-hours/i);
  });

  it("rewards a sustained, broad mentor record with a strong tier", () => {
    const entries: MentorHoursEntry[] = [];
    const mentors = ["Pat", "Sam", "Alex", "Jordan"];
    for (let m = 1; m <= 6; m += 1) {
      mentors.forEach((name, i) =>
        entries.push(
          entry({
            mentorName: name,
            role: i % 2 === 0 ? "professional_mentor" : "alumni_mentor",
            durationMinutes: 480,
            occurredOn: `2026-0${m}-1${i}`,
          }),
        ),
      );
    }
    const engagement = computeMentorEngagement(summarizeMentorHours(entries));
    expect(engagement.score).toBeGreaterThanOrEqual(0.66);
    expect(engagement.tier).toBe("strong");
    expect(engagement.monthsActive).toBe(6);
    expect(engagement.mentorsEngaged).toBe(4);
  });
});
