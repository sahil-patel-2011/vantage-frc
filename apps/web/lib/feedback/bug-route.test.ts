import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/feedback/bug: the corner "Send feedback" dialog and the Report-a-bug page both
 * land here. withRls and the session are stubbed; the SQL text and its parameters are what
 * is under test (kind, the team being kept only for a member, no severity on an idea).
 */
const state = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  query: vi.fn(),
  rateLimitOk: true,
  afterCalls: 0,
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@vantage/core", () => ({
  auth: { api: { getSession: async () => state.session } },
  resolveAuthBaseURL: () => "https://vantage.test",
}));
// The inbox email runs after the response; here it just records that it was queued.
vi.mock("next/server", () => ({ after: (work: () => unknown) => { state.afterCalls += 1; void work; } }));
vi.mock("@vantage/db", () => ({
  withRls: async (_context: unknown, work: (client: unknown) => Promise<unknown>) =>
    work({ query: state.query }),
}));
vi.mock("../rate-limit", async () => {
  const actual = await vi.importActual<typeof import("../rate-limit")>("../rate-limit");
  return { ...actual, createRateLimiter: () => ({ allow: async () => state.rateLimitOk }) };
});

const { POST } = await import("../../app/api/feedback/bug/route");

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function send(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request("https://vantage.test/api/feedback/bug", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://vantage.test", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  state.session = { user: { id: "11111111-1111-4111-8111-111111111111" } };
  state.rateLimitOk = true;
  state.query.mockReset().mockResolvedValue({ rows: [{ id: "report-1" }], rowCount: 1 });
});

describe("POST /api/feedback/bug", () => {
  it("files a problem by default and stores the page, team and screen size", async () => {
    const response = await send({
      description: "  The save button does nothing.  ",
      route: `/dashboard?orgId=${ORG}#top`,
      orgId: ORG,
      clientInfo: { viewportWidth: 390, viewportHeight: 844 },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", id: "report-1" });
    expect(state.afterCalls).toBeGreaterThan(0);

    const [sql, params] = state.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("INSERT INTO bug_reports (org_id, user_id, kind,");
    // Parameterized and cast; the team is only kept when the reporter belongs to it.
    expect(sql).toContain("is_org_member($1::uuid)");
    expect(params).toEqual([
      ORG,
      "11111111-1111-4111-8111-111111111111",
      "bug",
      `/dashboard?orgId=${ORG}`,
      "The save button does nothing.",
      null,
      "dashboard",
      JSON.stringify({ viewportWidth: 390, viewportHeight: 844 }),
    ]);
  });

  it("files an idea with no severity", async () => {
    const response = await send({ kind: "idea", description: "A pit-wall view.", severity: "blocking" });
    expect(response.status).toBe(200);
    const params = (state.query.mock.calls[0] as [string, unknown[]])[1];
    expect(params[2]).toBe("idea");
    expect(params[5]).toBeNull();
    // No team on the page: stored as a note to Vantage from the person alone.
    expect(params[0]).toBeNull();
  });

  it("refuses a kind it does not know without touching the database", async () => {
    const response = await send({ kind: "praise", description: "d" });
    expect(response.status).toBe(400);
    expect(state.query).not.toHaveBeenCalled();
  });

  it("refuses an empty note", async () => {
    expect((await send({ description: "" })).status).toBe(400);
    expect((await send({ description: "   " })).status).toBe(400);
    expect(state.query).not.toHaveBeenCalled();
  });

  it("requires sign-in", async () => {
    state.session = null;
    const response = await send({ description: "d" });
    expect(response.status).toBe(401);
    expect(state.query).not.toHaveBeenCalled();
  });

  it("asks for a pause instead of storing a flood", async () => {
    state.rateLimitOk = false;
    const response = await send({ description: "d" });
    expect(response.status).toBe(429);
    expect(state.query).not.toHaveBeenCalled();
  });

  it("blocks a cross-origin post", async () => {
    const response = await send({ description: "d" }, { origin: "https://other.test" });
    expect(response.status).toBe(403);
    expect(state.query).not.toHaveBeenCalled();
  });
});
