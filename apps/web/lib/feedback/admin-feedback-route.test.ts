import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /api/admin/feedback privilege gate and behaviour. assertPlatformAdmin, the MFA step-up check
 * and platformAdminDeniedResponse are the real ones (importActual), so a non-admin is refused
 * by the same code production runs. Only the session and the database client are stubbed; the
 * client answers by SQL text and records every statement so the tests can say what never ran.
 */
const state = vi.hoisted(() => ({
  session: null as { user: { id: string }; session: { id: string } } | null,
  isPlatformAdmin: false,
  mfaEnrolled: false,
  steppedUp: false,
  noteExists: true,
  statements: [] as Array<{ sql: string; params: unknown[] }>,
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

vi.mock("@vantage/core", async () => {
  const actual = await vi.importActual<typeof import("@vantage/core")>("@vantage/core");
  return { ...actual, auth: { api: { getSession: async () => state.session } } };
});

const ROW = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  kind: "idea",
  status: "new",
  description: "Let me pin a match to the top.",
  severity: null,
  route: "/competition?tab=strategy",
  clientInfo: { viewportWidth: 390, viewportHeight: 844, userAgent: "ignored" },
  createdAt: new Date("2026-10-10T12:00:00Z"),
  orgId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  orgName: "Test Team",
  teamNumber: 4242,
  reporterName: "Ada Member",
  reporterEmail: "ada@example.test",
};

vi.mock("@vantage/db", () => ({
  withRls: async (_context: unknown, work: (client: unknown) => Promise<unknown>) =>
    work({
      query: async (sql: string, params: unknown[] = []) => {
        state.statements.push({ sql, params });
        if (sql.includes("is_platform_admin")) return { rows: [{ allowed: state.isPlatformAdmin }], rowCount: 1 };
        if (sql.includes("user_mfa_enrollments")) return { rows: [], rowCount: state.mfaEnrolled ? 1 : 0 };
        if (sql.includes("mfa_step_up_sessions")) return { rows: [], rowCount: state.steppedUp ? 1 : 0 };
        if (sql.includes("FROM bug_reports b")) return { rows: [ROW], rowCount: 1 };
        if (sql.includes("GROUP BY kind, status")) {
          return {
            rows: [
              { kind: "bug", status: "new", count: 3 },
              { kind: "idea", status: "new", count: 2 },
              { kind: "bug", status: "fixed", count: 4 },
            ],
            rowCount: 3,
          };
        }
        if (sql.includes("UPDATE bug_reports")) {
          return state.noteExists
            ? { rows: [{ id: ROW.id, kind: "idea", status: params[1], orgId: ROW.orgId, userId: "u-1" }], rowCount: 1 }
            : { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 1 };
      },
    }),
}));

const { GET, POST } = await import("../../app/api/admin/feedback/route");

const ADMIN = { user: { id: "33333333-3333-4333-8333-333333333333" }, session: { id: "s-1" } };
const MEMBER = { user: { id: "11111111-1111-4111-8111-111111111111" }, session: { id: "s-2" } };

const get = (query = "") => GET(new Request(`https://vantage.test/api/admin/feedback${query}`));
const post = (body: unknown) =>
  POST(
    new Request("https://vantage.test/api/admin/feedback", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://vantage.test" },
      body: JSON.stringify(body),
    }),
  );

const ranAgainstFeedback = () =>
  state.statements.some((s) => s.sql.includes("bug_reports"));

beforeEach(() => {
  state.session = null;
  state.isPlatformAdmin = false;
  state.mfaEnrolled = false;
  state.steppedUp = false;
  state.noteExists = true;
  state.statements = [];
});

describe("GET /api/admin/feedback", () => {
  it("answers 401 without a session", async () => {
    expect((await get()).status).toBe(401);
    expect(ranAgainstFeedback()).toBe(false);
  });

  it("gives a signed-in non-admin a plain 404 and reads nothing", async () => {
    state.session = MEMBER;
    const response = await get();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
    expect(ranAgainstFeedback()).toBe(false);
  });

  it("lists newest first for a platform admin, with reporter, team, page and screen size", async () => {
    state.session = ADMIN;
    state.isPlatformAdmin = true;
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    const body = await response.json();
    expect(body.items).toEqual([
      {
        id: ROW.id,
        kind: "idea",
        status: "new",
        description: "Let me pin a match to the top.",
        severity: null,
        route: "/competition?tab=strategy",
        viewportWidth: 390,
        viewportHeight: 844,
        createdAt: "2026-10-10T12:00:00.000Z",
        orgId: ROW.orgId,
        orgName: "Test Team",
        teamNumber: 4242,
        reporterName: "Ada Member",
        reporterEmail: "ada@example.test",
      },
    ]);
    expect(body.hasMore).toBe(false);
    expect(body.counts).toEqual({
      newTotal: 5,
      total: 9,
      byKind: { bug: 7, idea: 2 },
      byStatus: { new: 5, triaged: 0, fixed: 4, wont_fix: 0 },
    });
    const list = state.statements.find((s) => s.sql.includes("FROM bug_reports b"))!;
    expect(list.sql).toContain("ORDER BY b.created_at DESC");
    expect(list.sql).toContain("$1::text IS NULL OR b.kind = $1::text");
  });

  it("passes the kind and status filters as parameters, and ignores values it does not know", async () => {
    state.session = ADMIN;
    state.isPlatformAdmin = true;
    await get("?kind=idea&status=triaged");
    const filtered = state.statements.find((s) => s.sql.includes("FROM bug_reports b"))!;
    expect(filtered.params.slice(0, 2)).toEqual(["idea", "triaged"]);

    state.statements = [];
    await get("?kind=praise&status=%27%3B%20DROP%20TABLE");
    const unknown = state.statements.find((s) => s.sql.includes("FROM bug_reports b"))!;
    expect(unknown.params.slice(0, 2)).toEqual([null, null]);
  });
});

describe("POST /api/admin/feedback", () => {
  it("answers 401 without a session", async () => {
    expect((await post({ id: ROW.id, status: "fixed" })).status).toBe(401);
    expect(ranAgainstFeedback()).toBe(false);
  });

  it("refuses a non-admin with a 404 and changes nothing, however the request is shaped", async () => {
    state.session = MEMBER;
    for (const body of [{ id: ROW.id, status: "fixed" }, { id: "not-a-uuid", status: "nope" }]) {
      const response = await post(body);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Not found" });
    }
    expect(ranAgainstFeedback()).toBe(false);
    expect(state.statements.some((s) => s.sql.includes("admin_actions"))).toBe(false);
  });

  it("moves a note to a new status as a platform admin and records who did it", async () => {
    state.session = ADMIN;
    state.isPlatformAdmin = true;
    const response = await post({ id: ROW.id, status: "triaged" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ id: ROW.id, status: "triaged" });
    expect(body.counts.newTotal).toBe(5);

    const update = state.statements.find((s) => s.sql.includes("UPDATE bug_reports"))!;
    expect(update.sql).toContain("$1::uuid");
    expect(update.params).toEqual([ROW.id, "triaged"]);
    const audit = state.statements.find((s) => s.sql.includes("admin_actions"))!;
    expect(audit.params[0]).toBe(ADMIN.user.id);
    expect(audit.params[1]).toBe("feedback.status_changed");
  });

  it("refuses a status that is not one of the four", async () => {
    state.session = ADMIN;
    state.isPlatformAdmin = true;
    const response = await post({ id: ROW.id, status: "deleted" });
    expect(response.status).toBe(400);
    expect(state.statements.some((s) => s.sql.includes("UPDATE bug_reports"))).toBe(false);
  });

  it("says so when the note is gone", async () => {
    state.session = ADMIN;
    state.isPlatformAdmin = true;
    state.noteExists = false;
    const response = await post({ id: ROW.id, status: "fixed" });
    expect(response.status).toBe(404);
    expect((await response.json()).error).toMatch(/no longer exists/i);
  });

  it("asks an enrolled admin for their authenticator before changing anything", async () => {
    state.session = ADMIN;
    state.isPlatformAdmin = true;
    state.mfaEnrolled = true;
    const response = await post({ id: ROW.id, status: "fixed" });
    expect(response.status).toBe(403);
    expect(state.statements.some((s) => s.sql.includes("UPDATE bug_reports"))).toBe(false);

    state.steppedUp = true;
    expect((await post({ id: ROW.id, status: "fixed" })).status).toBe(200);
  });
});
