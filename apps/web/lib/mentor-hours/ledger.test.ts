import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import {
  MENTOR_HOURS_LEDGER,
  assertPositiveDuration,
  deleteMentorHoursEntry,
  insertMentorHoursEntry,
  isUuid,
  listMentorHoursEntries,
  listMentorHoursSeasons,
  positiveDurationMinutes,
} from "./ledger";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const ENTRY = "22222222-2222-4222-8222-222222222222";

type Call = { sql: string; params: unknown[] };

function recordingClient(
  handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number } = () => ({
    rows: [],
  }),
): { client: PoolClient; calls: Call[] } {
  const calls: Call[] = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return handler(sql, params);
    }),
  } as unknown as PoolClient;
  return { client, calls };
}

function assertMentorLedgerOnly(calls: Call[]) {
  for (const call of calls) {
    expect(call.sql).not.toMatch(/hour_logs/i);
    expect(call.sql).toContain(MENTOR_HOURS_LEDGER);
  }
}

describe("positiveDurationMinutes", () => {
  it("accepts whole positive minutes and rejects zero or junk", () => {
    expect(positiveDurationMinutes(90)).toBe(90);
    expect(positiveDurationMinutes("45")).toBe(45);
    expect(positiveDurationMinutes(1.4)).toBe(1);
    expect(positiveDurationMinutes(0)).toBeNull();
    expect(positiveDurationMinutes(-10)).toBeNull();
    expect(positiveDurationMinutes("")).toBeNull();
    expect(positiveDurationMinutes(undefined)).toBeNull();
  });

  it("throws when a write tries to log a zero-minute entry", () => {
    expect(() => assertPositiveDuration(0)).toThrow(/positive number of minutes/i);
  });
});

describe("isUuid", () => {
  it("accepts a v4 uuid and rejects names", () => {
    expect(isUuid(USER)).toBe(true);
    expect(isUuid("Pat Mentor")).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
});

describe("mentor hours ledger SQL", () => {
  it("lists only mentor_hours_entries for the requested org and season", async () => {
    const { client, calls } = recordingClient((sql) => {
      if (sql.includes("FROM mentor_hours_entries") && sql.includes("SELECT id")) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const entries = await listMentorHoursEntries(client, { orgId: ORG, seasonYear: 2026 });
    expect(entries).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.params).toEqual([ORG, 2026]);
    assertMentorLedgerOnly(calls);
  });

  it("lists seasons from mentor_hours_entries, never hour_logs", async () => {
    const { client, calls } = recordingClient(() => ({ rows: [{ seasonYear: 2026 }] }));
    const seasons = await listMentorHoursSeasons(client, ORG);
    expect(seasons).toEqual([2026]);
    expect(calls[0]!.params).toEqual([ORG]);
    assertMentorLedgerOnly(calls);
  });

  it("inserts a volunteer row into mentor_hours_entries with org and author stamps", async () => {
    const { client, calls } = recordingClient();
    await insertMentorHoursEntry(client, {
      orgId: ORG,
      userId: USER,
      mentorName: "Pat Parent",
      mentorUserId: USER,
      role: "parent_volunteer",
      category: "outreach",
      occurredOn: "2026-03-01",
      durationMinutes: 120,
      notes: "Shop night",
      seasonYear: 2026,
    });

    expect(calls).toHaveLength(1);
    const write = calls[0]!;
    expect(write.sql).toMatch(/INSERT INTO mentor_hours_entries/i);
    expect(write.sql).not.toMatch(/hour_logs/i);
    expect(write.params).toEqual([
      ORG,
      "Pat Parent",
      "parent_volunteer",
      "outreach",
      "2026-03-01",
      120,
      "Shop night",
      2026,
      USER,
      USER,
    ]);
  });

  it("refuses to insert a zero-duration row and never touches the database", async () => {
    const { client, calls } = recordingClient();
    await expect(
      insertMentorHoursEntry(client, {
        orgId: ORG,
        userId: USER,
        mentorName: "Pat",
        role: "mentor",
        category: "build",
        occurredOn: "2026-03-01",
        durationMinutes: 0,
        notes: null,
        seasonYear: 2026,
      }),
    ).rejects.toThrow(/positive number of minutes/i);
    expect(calls).toHaveLength(0);
  });

  it("deletes only the named mentor_hours_entries row in the caller's org", async () => {
    const { client, calls } = recordingClient();
    await deleteMentorHoursEntry(client, { orgId: ORG, entryId: ENTRY });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.sql).toMatch(/DELETE FROM mentor_hours_entries/i);
    expect(calls[0]!.sql).not.toMatch(/hour_logs/i);
    expect(calls[0]!.params).toEqual([ENTRY, ORG]);
  });
});
