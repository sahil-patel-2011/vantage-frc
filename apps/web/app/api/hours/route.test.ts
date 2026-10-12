/**
 * POST /api/hours (A5-03): typed-in hours can't be in the future, can't land on hours already
 * logged, and a mentor corrects an entry's times with a note instead of deleting it.
 * The database is a fake that answers by SQL shape; 0723's trigger and RLS are checked against
 * a real PostgreSQL when the migration is replayed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "11111111-1111-4111-8111-111111111111";
const STUDENT = "22222222-2222-4222-8222-222222222222";
const MENTOR = "33333333-3333-4333-8333-333333333333";
const ENTRY = "44444444-4444-4444-8444-444444444444";

type Query = { sql: string; params: unknown[] };

const state = vi.hoisted(() => ({
  userId: "",
  role: "scout",
  clash: null as { clockIn: string; clockOut: string | null } | null,
  queries: [] as Query[],
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@vantage/core", () => ({
  auth: { api: { getSession: async () => (state.userId ? { user: { id: state.userId } } : null) } },
}));
vi.mock("@vantage/db", () => {
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      state.queries.push({ sql, params });
      if (sql.includes("SELECT role FROM memberships")) return { rowCount: 1, rows: [{ role: state.role }] };
      if (sql.includes("COALESCE(clock_out, now()) >")) return { rowCount: state.clash ? 1 : 0, rows: state.clash ? [state.clash] : [] };
      if (sql.includes("INSERT INTO hour_logs")) return { rowCount: 1, rows: [{ id: ENTRY }] };
      if (sql.includes("FROM hour_logs WHERE id = $1::uuid")) {
        return {
          rowCount: 1,
          rows: [{ userId: STUDENT, clockIn: "2026-10-10 22:00:00+00", clockOut: "2026-10-11 08:00:00+00" }],
        };
      }
      return { rowCount: 1, rows: [] };
    },
  };
  return { withRls: async (_context: unknown, work: (c: typeof client) => Promise<unknown>) => work(client) };
});

const { POST } = await import("./route");

function post(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/hours", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: ORG, ...body }),
    }),
  );
}

const writes = () => state.queries.filter((q) => /INSERT INTO hour_logs|UPDATE hour_logs/.test(q.sql));

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

beforeEach(() => {
  state.userId = STUDENT;
  state.role = "scout";
  state.clash = null;
  state.queries = [];
});

describe("a student adding hours by hand", () => {
  it("is refused for a session in the future", async () => {
    const response = await post({ action: "add_manual", clockIn: "2099-01-05T10:00:00Z", clockOut: "2099-01-05T14:00:00Z" });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/haven't happened yet/);
    expect(writes()).toEqual([]);
  });

  it("is refused when the hours overlap a session already logged, naming it", async () => {
    state.clash = { clockIn: "2026-10-10 17:00:00+00", clockOut: "2026-10-10 21:00:00+00" };
    const response = await post({
      action: "add_manual",
      clockIn: hoursAgo(5),
      clockOut: hoursAgo(3),
      timeZone: "America/New_York",
    });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toBe(
      "Those hours overlap an entry already logged (Oct 10, 2026, 1:00 PM – 5:00 PM). Change the times, or ask a mentor to correct the other entry.",
    );
    expect(writes()).toEqual([]);
  });

  it("is saved when it is in the past and clear of other sessions", async () => {
    const response = await post({ action: "add_manual", clockIn: hoursAgo(5), clockOut: hoursAgo(3) });
    expect(response.status).toBe(200);
    expect(writes()).toHaveLength(1);
  });
});

describe("a mentor correcting an entry", () => {
  it("is refused for a student", async () => {
    const response = await post({ action: "correct_record", id: ENTRY, clockIn: hoursAgo(5), clockOut: hoursAgo(3), note: "Fix" });
    expect(response.status).toBe(403);
    expect(writes()).toEqual([]);
  });

  it("saves the new times with a note that keeps the old ones", async () => {
    state.userId = MENTOR;
    state.role = "admin";
    const response = await post({
      action: "correct_record",
      id: ENTRY,
      clockIn: hoursAgo(5),
      clockOut: hoursAgo(3),
      note: "Forgot to clock out at 6 PM",
      timeZone: "UTC",
    });
    expect(response.status).toBe(200);
    const update = writes()[0]!;
    expect(update.sql).toContain("correction_note = $6");
    expect(update.params[4]).toBe(MENTOR);
    expect(update.params[5]).toBe("Was Oct 10, 2026, 10:00 PM – Oct 11, 2026, 8:00 AM. Forgot to clock out at 6 PM");
    // The overlap check skips the entry being corrected.
    const overlap = state.queries.find((q) => q.sql.includes("COALESCE(clock_out, now()) >"))!;
    expect(overlap.params[4]).toBe(ENTRY);
  });
});
