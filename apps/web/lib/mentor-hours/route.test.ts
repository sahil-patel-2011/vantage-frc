import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route contract for /api/mentor-hours. Auth and withRls are stubbed; the real
 * compute + ledger SQL run against a recording client so we can prove the
 * volunteer ledger never touches student hour_logs.
 */

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";

type Call = { sql: string; params: unknown[] };

type EntryRow = {
  id: string;
  mentorName: string;
  mentorUserId: string | null;
  role: string;
  category: string;
  occurredOn: string;
  durationMinutes: number;
  seasonYear: number;
  notes: string | null;
};

const state = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  member: false,
  entries: [] as EntryRow[],
  calls: [] as Call[],
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

vi.mock("@vantage/core", async () => {
  const actual = await vi.importActual<typeof import("@vantage/core")>("@vantage/core");
  return {
    ...actual,
    auth: { api: { getSession: async () => state.session } },
  };
});

vi.mock("@vantage/db", () => ({
  withRls: async (_context: unknown, work: (client: unknown) => Promise<unknown>) =>
    work({
      query: async (sql: string, params: unknown[] = []) => {
        state.calls.push({ sql, params });
        if (sql.includes("FROM memberships")) {
          return state.member
            ? { rows: [{ orgId: ORG, teamNumber: 254 }], rowCount: 1 }
            : { rows: [], rowCount: 0 };
        }
        if (sql.includes("INSERT INTO mentor_hours_entries")) {
          state.entries.push({
            id: `e-${state.entries.length + 1}`,
            mentorName: String(params[1] ?? ""),
            mentorUserId: (params[9] as string | null) ?? null,
            role: String(params[2] ?? "mentor"),
            category: String(params[3] ?? "build"),
            occurredOn: String(params[4] ?? ""),
            durationMinutes: Number(params[5] ?? 0),
            seasonYear: Number(params[7] ?? 2026),
            notes: (params[6] as string | null) ?? null,
          });
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes("DELETE FROM mentor_hours_entries")) {
          state.entries = [];
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes("FROM mentor_hours_entries") && sql.includes("SELECT id")) {
          return { rows: state.entries, rowCount: state.entries.length };
        }
        if (sql.includes("DISTINCT season_year")) {
          const years = [...new Set(state.entries.map((row) => row.seasonYear))];
          return { rows: years.map((seasonYear) => ({ seasonYear })) };
        }
        return { rows: [], rowCount: 0 };
      },
    }),
}));

const { GET, POST } = await import("../../app/api/mentor-hours/route");

beforeEach(() => {
  state.session = null;
  state.member = false;
  state.entries = [];
  state.calls = [];
});

function getRequest(query = "") {
  return new Request(`http://localhost/api/mentor-hours${query}`);
}

function postRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/mentor-hours", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/mentor-hours", () => {
  it("returns 401 when there is no session", async () => {
    const response = await GET(getRequest());
    expect(response.status).toBe(401);
  });

  it("returns empty (not fabricated scores) when the mentor ledger has no rows", async () => {
    state.session = { user: { id: USER } };
    state.member = true;
    const response = await GET(getRequest(`?orgId=${ORG}&season=2026`));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; summary?: unknown };
    expect(body.status).toBe("empty");
    expect(body.summary).toBeUndefined();
    expect(state.calls.every((call) => !/hour_logs/i.test(call.sql))).toBe(true);
    expect(state.calls.some((call) => call.sql.includes("mentor_hours_entries"))).toBe(true);
  });
});

describe("POST /api/mentor-hours", () => {
  it("returns 401 when there is no session", async () => {
    const response = await POST(postRequest({ orgId: ORG, action: "log-entry" }));
    expect(response.status).toBe(401);
  });

  it("refuses a zero-duration log and never writes hour_logs", async () => {
    state.session = { user: { id: USER } };
    state.member = true;
    const response = await POST(
      postRequest({
        orgId: ORG,
        action: "log-entry",
        mentorName: "Pat",
        occurredOn: "2026-03-01",
        durationMinutes: 0,
      }),
    );
    expect(response.status).toBe(400);
    expect(state.calls.every((call) => !/INSERT/i.test(call.sql))).toBe(true);
    expect(state.calls.every((call) => !/hour_logs/i.test(call.sql))).toBe(true);
  });

  it("writes mentor_hours_entries and returns a live view — never hour_logs", async () => {
    state.session = { user: { id: USER } };
    state.member = true;
    const response = await POST(
      postRequest({
        orgId: ORG,
        action: "log-entry",
        mentorName: "Pat Mentor",
        occurredOn: "2026-03-01",
        role: "parent_volunteer",
        category: "outreach",
        durationMinutes: 90,
        seasonYear: 2026,
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      entries: Array<{ mentorName: string; durationMinutes: number }>;
    };
    expect(body.status).toBe("live");
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).toMatchObject({ mentorName: "Pat Mentor", durationMinutes: 90 });
    expect(state.calls.some((call) => /INSERT INTO mentor_hours_entries/i.test(call.sql))).toBe(true);
    expect(state.calls.every((call) => !/hour_logs/i.test(call.sql))).toBe(true);
  });
});
