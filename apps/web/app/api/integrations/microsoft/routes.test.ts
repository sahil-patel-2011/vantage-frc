import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route-level authorization for /api/integrations/microsoft/*. The session, the database
 * and next/headers are mocked; the routes' own checks run for real. The role returned by
 * the membership query is what each case varies.
 */

const state = vi.hoisted(() => ({
  userId: "6925a000-0000-4000-8000-000000000002" as string | null,
  role: "admin" as string | null,
  connected: false,
  importMigrated: true,
  deleted: 0,
  queries: [] as string[],
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

vi.mock("@vantage/core", () => ({
  auth: { api: { getSession: async () => (state.userId ? { user: { id: state.userId } } : null) } },
}));

vi.mock("@vantage/db", () => {
  const client = {
    async query(sql: string) {
      state.queries.push(sql);
      if (sql.includes("FROM memberships")) return { rows: state.role ? [{ role: state.role }] : [], rowCount: state.role ? 1 : 0 };
      if (sql.includes("to_regclass('workbook_import_runs')")) return { rows: [{ ready: state.importMigrated }], rowCount: 1 };
      if (sql.includes("FROM org_microsoft_connection_status")) {
        return {
          rows: state.connected
            ? [{ accountName: "Coach", accountEmail: "coach@example.org", workbookWebUrl: "https://x", workbookName: "Vantage – Team 1.xlsx", workbookItemId: "i", connectedAt: "t", lastSyncAt: null, lastError: null, lastErrorAt: null }]
            : [],
          rowCount: state.connected ? 1 : 0,
        };
      }
      if (sql.includes("FROM workbook_sync_runs")) return { rows: [], rowCount: 0 };
      if (sql.includes("DELETE FROM org_microsoft_connections")) {
        state.deleted += 1;
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("FROM org_microsoft_connections")) return { rows: [], rowCount: 0 };
      throw new Error(`unexpected query ${sql.slice(0, 60)}`);
    },
  };
  return {
    withRls: async (_ctx: unknown, work: (c: typeof client) => unknown) => work(client),
    withSavepointOrThrow: async (_c: unknown, work: () => unknown) => work(),
  };
});

const ORG = "6925a000-0000-4000-8000-000000000001";
const CONFIGURED = {
  MICROSOFT_CLIENT_ID: "client-id",
  MICROSOFT_CLIENT_SECRET: "client-secret",
  BETTER_AUTH_SECRET: "route-test-secret",
  BETTER_AUTH_URL: "https://vantage.example",
};

function setEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

beforeEach(() => {
  state.userId = "6925a000-0000-4000-8000-000000000002";
  state.role = "admin";
  state.connected = false;
  state.importMigrated = true;
  state.deleted = 0;
  state.queries = [];
  setEnv(CONFIGURED);
});

afterEach(() => {
  setEnv({ MICROSOFT_CLIENT_ID: undefined, MICROSOFT_CLIENT_SECRET: undefined });
});

const post = (path: string, body: unknown, method = "POST") =>
  new Request(`https://vantage.example${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /sync", () => {
  it("401 when signed out", async () => {
    state.userId = null;
    const { POST } = await import("./sync/route");
    expect((await POST(post("/api/integrations/microsoft/sync", { orgId: ORG }))).status).toBe(401);
  });

  it("400 on a bad orgId", async () => {
    const { POST } = await import("./sync/route");
    expect((await POST(post("/api/integrations/microsoft/sync", { orgId: "x" }))).status).toBe(400);
  });

  it("403 for a scout, before any Microsoft or connection access", async () => {
    state.role = "scout";
    const { POST } = await import("./sync/route");
    const response = await POST(post("/api/integrations/microsoft/sync", { orgId: ORG }));
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe("not_manager");
    expect(state.queries.some((q) => q.includes("org_microsoft_connections"))).toBe(false);
  });

  it("503 setup_required when there is no Microsoft app registration", async () => {
    setEnv({ MICROSOFT_CLIENT_ID: undefined });
    const { POST } = await import("./sync/route");
    const response = await POST(post("/api/integrations/microsoft/sync", { orgId: ORG }));
    expect(response.status).toBe(503);
    const body = (await response.json()) as { code: string; error: string };
    expect(body.code).toBe("setup_required");
    expect(body.error).toContain("docs/MICROSOFT_EXCEL.md");
  });

  it("409 not_connected for an admin whose team has not connected", async () => {
    const { POST } = await import("./sync/route");
    const response = await POST(post("/api/integrations/microsoft/sync", { orgId: ORG }));
    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe("not_connected");
  });
});

describe("POST /import/preview", () => {
  const url = "/api/integrations/microsoft/import/preview";

  it("401 when signed out", async () => {
    state.userId = null;
    const { POST } = await import("./import/preview/route");
    expect((await POST(post(url, { orgId: ORG }))).status).toBe(401);
  });

  it("403 for a scout, before reading the connection or the workbook", async () => {
    state.role = "scout";
    const { POST } = await import("./import/preview/route");
    const response = await POST(post(url, { orgId: ORG }));
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe("not_manager");
    expect(state.queries.some((q) => q.includes("org_microsoft_connections") || q.includes("scout_entries"))).toBe(false);
  });

  it("503 setup_required when there is no Microsoft app registration", async () => {
    setEnv({ MICROSOFT_CLIENT_SECRET: undefined });
    const { POST } = await import("./import/preview/route");
    const response = await POST(post(url, { orgId: ORG }));
    expect(response.status).toBe(503);
    expect(((await response.json()) as { code: string }).code).toBe("setup_required");
  });

  it("503 not_migrated until migration 0676 is applied", async () => {
    state.importMigrated = false;
    const { POST } = await import("./import/preview/route");
    const response = await POST(post(url, { orgId: ORG }));
    expect(response.status).toBe(503);
    const body = (await response.json()) as { code: string; error: string };
    expect(body.code).toBe("not_migrated");
    expect(body.error).toContain("0676");
  });

  it("409 not_connected for an admin whose team has not connected", async () => {
    const { POST } = await import("./import/preview/route");
    const response = await POST(post(url, { orgId: ORG }));
    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe("not_connected");
  });
});

describe("POST /import/apply", () => {
  const url = "/api/integrations/microsoft/import/apply";
  const someId = "0123456789abcdef01234567";

  it("400 without confirmed change ids", async () => {
    const { POST } = await import("./import/apply/route");
    const response = await POST(post(url, { orgId: ORG, changeIds: ["not-a-change-id"] }));
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe("no_changes");
  });

  it("403 for a viewer, and writes nothing", async () => {
    state.role = "viewer";
    const { POST } = await import("./import/apply/route");
    const response = await POST(post(url, { orgId: ORG, changeIds: [someId] }));
    expect(response.status).toBe(403);
    expect(state.queries.some((q) => /UPDATE|INSERT/.test(q))).toBe(false);
  });

  it("409 not_connected for an admin whose team has not connected", async () => {
    const { POST } = await import("./import/apply/route");
    const response = await POST(post(url, { orgId: ORG, changeIds: [someId] }));
    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe("not_connected");
  });
});

describe("DELETE /disconnect", () => {
  it("refuses a viewer and deletes nothing", async () => {
    state.role = "viewer";
    const { DELETE } = await import("./disconnect/route");
    expect((await DELETE(post("/api/integrations/microsoft/disconnect", { orgId: ORG }, "DELETE"))).status).toBe(403);
    expect(state.deleted).toBe(0);
  });

  it("lets an owner disconnect", async () => {
    state.role = "owner";
    const { DELETE } = await import("./disconnect/route");
    const response = await DELETE(post("/api/integrations/microsoft/disconnect", { orgId: ORG }, "DELETE"));
    expect(response.status).toBe(200);
    expect(state.deleted).toBe(1);
  });
});

describe("GET /status", () => {
  it("shows a scout the connection but not deployment config or sync history", async () => {
    state.role = "scout";
    state.connected = true;
    setEnv({ MICROSOFT_CLIENT_ID: undefined });
    const { GET } = await import("./status/route");
    const response = await GET(new Request(`https://vantage.example/api/integrations/microsoft/status?orgId=${ORG}`));
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.canManage).toBe(false);
    expect(body.connected).toBe(true);
    expect(body.missingEnv).toEqual([]);
    expect(body.callbackUrl).toBeNull();
    expect(state.queries.some((q) => q.includes("workbook_sync_runs"))).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/ciphertext|refresh/i);
  });

  it("403 for someone outside the team", async () => {
    state.role = null;
    const { GET } = await import("./status/route");
    expect((await GET(new Request(`https://vantage.example/api/integrations/microsoft/status?orgId=${ORG}`))).status).toBe(403);
  });
});

describe("GET /connect", () => {
  it("sends a scout back to Connectors with not_manager", async () => {
    state.role = "scout";
    const { GET } = await import("./connect/route");
    const response = await GET(new Request(`https://vantage.example/api/integrations/microsoft/connect?orgId=${ORG}`));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("reason=not_manager");
  });

  it("sends an admin to Microsoft with a signed state and PKCE", async () => {
    const { GET } = await import("./connect/route");
    const response = await GET(new Request(`https://vantage.example/api/integrations/microsoft/connect?orgId=${ORG}`));
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location")!);
    expect(location.host).toBe("login.microsoftonline.com");
    expect(location.searchParams.get("state")).toMatch(/^[\w-]+\.[\w-]+$/);
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("redirect_uri")).toBe("https://vantage.example/api/integrations/microsoft/callback");
  });

  it("reports setup_required when unconfigured", async () => {
    setEnv({ MICROSOFT_CLIENT_SECRET: undefined });
    const { GET } = await import("./connect/route");
    const response = await GET(new Request(`https://vantage.example/api/integrations/microsoft/connect?orgId=${ORG}`));
    expect(response.headers.get("location")).toContain("reason=setup_required");
  });
});

describe("GET /callback", () => {
  it("rejects a state that was not issued by this server, without calling Microsoft", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { GET } = await import("./callback/route");
    const response = await GET(
      new Request("https://vantage.example/api/integrations/microsoft/callback?code=abc&state=forged.state"),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("reason=state");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("rejects a valid state issued to a different user", async () => {
    const { createMicrosoftOAuthState } = await import("../../../../lib/microsoft/oauth-state");
    const stateFromOtherUser = createMicrosoftOAuthState({ orgId: ORG, userId: "6925a000-0000-4000-8000-00000000beef" });
    const { GET } = await import("./callback/route");
    const response = await GET(
      new Request(
        `https://vantage.example/api/integrations/microsoft/callback?code=abc&state=${encodeURIComponent(stateFromOtherUser)}`,
      ),
    );
    expect(response.headers.get("location")).toContain("reason=state");
  });

  it("maps a cancelled consent to reason=denied", async () => {
    const { GET } = await import("./callback/route");
    const response = await GET(
      new Request("https://vantage.example/api/integrations/microsoft/callback?error=access_denied&error_description=x"),
    );
    expect(response.headers.get("location")).toContain("reason=denied");
  });
});
