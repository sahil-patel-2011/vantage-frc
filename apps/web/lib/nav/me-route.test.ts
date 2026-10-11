import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string; email: string; name: string | null; image: string | null } },
  sessionError: null as Error | null,
  dbError: null as Error | null,
  reported: [] as Array<{ error: unknown; source: string }>,
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("../paid-plan", () => ({ isPayingOrgEntitlement: () => false }));
vi.mock("../reference/tba-access", () => ({ resolveTbaConfigured: async () => false }));
vi.mock("../notifications/inbox-store", () => ({ unreadNotificationCount: async () => 0 }));
vi.mock("@vantage/core", () => ({
  auth: {
    api: {
      getSession: async () => {
        if (state.sessionError) throw state.sessionError;
        return state.session;
      },
    },
  },
  listMemberHubAccess: async () => [],
}));
// Outage reporting runs after the response; here it runs at once so the test can see it.
vi.mock("../outage/defer", () => ({ deferOutageWork: (task: () => Promise<unknown>) => void task() }));
vi.mock("../outage/incident", () => ({
  reportDatabaseFailure: async (error: unknown, source: string) => {
    state.reported.push({ error, source });
  },
}));
vi.mock("../outage/recipient-refresh", () => ({ refreshRecipientSnapshotIfStale: async () => undefined }));
vi.mock("@vantage/db", () => ({
  withSavepoint: async (_client: unknown, work: () => Promise<unknown>, fallback: unknown) => work().catch(() => fallback),
  withRls: async () => {
    if (state.dbError) throw state.dbError;
    throw new Error("not reached in these tests");
  },
}));

const { GET } = await import("../../app/api/me/route");

describe("GET /api/me", () => {
  beforeEach(() => {
    state.session = { user: { id: "user-1", email: "a@example.test", name: null, image: null } };
    state.sessionError = null;
    state.dbError = null;
    state.reported = [];
  });

  it("answers 401 only when there is no session", async () => {
    state.session = null;
    const response = await GET(new Request("http://localhost/api/me"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ authenticated: false });
  });

  it("answers 503, not signed out, when the database fails", async () => {
    state.dbError = new Error("connection terminated unexpectedly");
    const response = await GET(new Request("http://localhost/api/me"));
    expect(response.status).toBe(503);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.authenticated).toBeUndefined();
    expect(body.error).toMatch(/could not be loaded/);
    // The internal reason never reaches the client.
    expect(JSON.stringify(body)).not.toMatch(/connection terminated/);
    expect(response.headers.get("cache-control")).toContain("no-store");
    // A connection failure opens (or extends) an outage incident for the owner.
    expect(state.reported).toEqual([{ error: state.dbError, source: "api/me" }]);
  });

  it("does not report an outage for a missing session or an error that isn't the database", async () => {
    state.session = null;
    await GET(new Request("http://localhost/api/me"));
    state.session = { user: { id: "user-1", email: "a@example.test", name: null, image: null } };
    state.dbError = Object.assign(new Error('relation "profiles" does not exist'), { code: "42P01" });
    await GET(new Request("http://localhost/api/me"));
    expect(state.reported).toEqual([]);
  });

  it("answers 503 when the session store itself is unreachable", async () => {
    state.sessionError = new Error("auth database unavailable");
    const response = await GET(new Request("http://localhost/api/me"));
    expect(response.status).toBe(503);
    // Not recognisably a database connection failure: nobody is paged.
    expect(state.reported).toEqual([]);

    // The session lookup failing because the database can't be reached does count.
    state.sessionError = new Error("Failed to get session", {
      cause: Object.assign(new Error("connect ECONNREFUSED 203.0.113.9:5432"), { code: "ECONNREFUSED" }),
    });
    await GET(new Request("http://localhost/api/me"));
    expect(state.reported).toEqual([{ error: state.sessionError, source: "api/me" }]);
  });
});
