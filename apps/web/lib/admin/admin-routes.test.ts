import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The privilege gate and the contracts of the rebuilt platform-admin routes. assertPlatformAdmin
 * and the route code run for real; only the session, withRls (one fake client) and the email
 * provider are stubbed. The SQL itself is exercised against Postgres in qa/admin/rls-0727.sql.
 */
const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string; email: string }; session: { id: string; createdAt: Date } },
  isPlatformAdmin: false,
  queries: [] as Array<{ sql: string; params: unknown[] }>,
  respond: null as null | ((sql: string, params: unknown[]) => { rows: unknown[]; rowCount: number } | undefined),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/server", () => ({ after: () => undefined }));

vi.mock("@vantage/core", async () => {
  const actual = await vi.importActual<typeof import("@vantage/core")>("@vantage/core");
  return {
    ...actual,
    auth: { api: { getSession: async () => state.session } },
    assertPlatformPrivilegeMfa: async () => ({ bootstrap: true }),
  };
});

const client = {
  query: async (sql: string, params: unknown[] = []) => {
    state.queries.push({ sql, params });
    if (sql.includes("is_platform_admin() AS allowed")) return { rows: [{ allowed: state.isPlatformAdmin }], rowCount: 1 };
    if (sql.includes("current_app_user_id() AS id")) return { rows: [{ id: state.session?.user.id }], rowCount: 1 };
    const answer = state.respond?.(sql, params);
    return answer ?? { rows: [], rowCount: 0 };
  },
};

vi.mock("@vantage/db", () => ({
  withRls: async (_context: unknown, work: (c: unknown) => Promise<unknown>) => work(client),
  withSavepoint: async (_c: unknown, work: () => Promise<unknown>, fallback: unknown) => {
    try {
      return await work();
    } catch {
      return fallback;
    }
  },
}));

const ADMIN = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ORG = "33333333-3333-4333-8333-333333333333";

function signIn(options: { admin: boolean; hoursAgo?: number }) {
  state.session = {
    user: { id: ADMIN, email: "platform-owner@vantage.test" },
    session: { id: "s1", createdAt: new Date(Date.now() - (options.hoursAgo ?? 1) * 3_600_000) },
  };
  state.isPlatformAdmin = options.admin;
}

function req(method: string, url: string, body?: unknown) {
  return new Request(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const platformAdmins = await import("../../app/api/admin/platform-admins/route");
const aiCredits = await import("../../app/api/admin/ai-credits/route");
const aiKeys = await import("../../app/api/admin/ai-keys/route");
const health = await import("../../app/api/admin/health/route");
const overview = await import("../../app/api/admin/overview/route");

beforeEach(() => {
  state.session = null;
  state.isPlatformAdmin = false;
  state.queries = [];
  state.respond = null;
});

const CALLS: Array<[string, () => Promise<Response>]> = [
  ["GET platform-admins", () => platformAdmins.GET()],
  ["POST platform-admins", () => platformAdmins.POST(req("POST", "/api/admin/platform-admins", { action: "add", email: "x@example.test" }))],
  ["DELETE platform-admins", () => platformAdmins.DELETE(req("DELETE", "/api/admin/platform-admins", { userId: OTHER }))],
  ["GET ai-credits", () => aiCredits.GET(req("GET", "/api/admin/ai-credits"))],
  ["POST ai-credits", () => aiCredits.POST(req("POST", "/api/admin/ai-credits", { orgId: ORG }))],
  ["DELETE ai-credits", () => aiCredits.DELETE(req("DELETE", "/api/admin/ai-credits", { giftId: OTHER }))],
  ["GET ai-keys", () => aiKeys.GET()],
  ["POST ai-keys", () => aiKeys.POST(req("POST", "/api/admin/ai-keys", { family: "claude", label: "x", envName: "ANTHROPIC_API_KEY" }))],
  ["PATCH ai-keys", () => aiKeys.PATCH(req("PATCH", "/api/admin/ai-keys", { id: OTHER, enabled: false }))],
  ["DELETE ai-keys", () => aiKeys.DELETE(req("DELETE", "/api/admin/ai-keys", { id: OTHER }))],
  ["GET health", () => health.GET(req("GET", "/api/admin/health"))],
  ["GET health detail", () => health.GET(req("GET", "/api/admin/health?module=database"))],
  ["GET overview", () => overview.GET()],
];

describe("platform-admin routes: who may call them", () => {
  it.each(CALLS)("%s answers 401 without a session", async (_name, call) => {
    const response = await call();
    expect(response.status).toBe(401);
  });

  it.each(CALLS)("%s answers 404 to a signed-in non-admin and runs nothing else", async (_name, call) => {
    signIn({ admin: false });
    const response = await call();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
    // Nothing beyond the admin check reached the database.
    expect(state.queries.every((q) => q.sql.includes("is_platform_admin"))).toBe(true);
  });
});

describe("platform admins", () => {
  it("lists admins with who you are, and whether removing is possible", async () => {
    signIn({ admin: true });
    state.respond = (sql) =>
      sql.includes("platform_admin_list()")
        ? { rows: [{ userId: ADMIN, email: "platform-owner@vantage.test", name: "Owner", grantedAt: "2026-01-01", grantedByEmail: null }], rowCount: 1 }
        : undefined;
    const body = await (await platformAdmins.GET()).json();
    expect(body.admins).toEqual([expect.objectContaining({ userId: ADMIN, you: true })]);
    expect(body.abilities.canRemoveSelf).toBe(false);
    expect(body.sessionFresh).toBe(true);
  });

  it("needs a sign-in from the last 24 hours to change admins", async () => {
    signIn({ admin: true, hoursAgo: 30 });
    const response = await platformAdmins.POST(req("POST", "/api/admin/platform-admins", { action: "add", email: "new@example.test" }));
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("reauth_required");
    expect(state.queries.some((q) => q.sql.includes("platform_admin_add"))).toBe(false);
  });

  it("adds by a normalized email through the database function", async () => {
    signIn({ admin: true });
    state.respond = (sql) => (sql.includes("platform_admin_add") ? { rows: [{ id: OTHER }], rowCount: 1 } : undefined);
    const response = await platformAdmins.POST(req("POST", "/api/admin/platform-admins", { action: "add", email: "  New@Example.TEST " }));
    expect(response.status).toBe(200);
    const call = state.queries.find((q) => q.sql.includes("platform_admin_add"))!;
    expect(call.params).toEqual(["new@example.test"]);
  });

  it("says the last-admin rule in words, from the database's refusal", async () => {
    signIn({ admin: true });
    state.respond = (sql) => {
      if (sql.includes("platform_admin_remove")) throw Object.assign(new Error("Vantage needs at least one platform admin"), { code: "42501", detail: "vantage:last_admin" });
      return undefined;
    };
    const response = await platformAdmins.DELETE(req("DELETE", "/api/admin/platform-admins", { userId: ADMIN }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/at least one platform admin/);
  });

  it("refuses to transfer to yourself before touching the database", async () => {
    signIn({ admin: true });
    const response = await platformAdmins.POST(req("POST", "/api/admin/platform-admins", { action: "transfer", email: "platform-owner@vantage.test" }));
    expect(response.status).toBe(400);
    expect(state.queries.some((q) => q.sql.includes("platform_admin_transfer"))).toBe(false);
  });

  it("sends you home after a transfer, since you are no longer an admin", async () => {
    signIn({ admin: true });
    state.respond = (sql) => (sql.includes("platform_admin_transfer") ? { rows: [{ id: OTHER }], rowCount: 1 } : undefined);
    const body = await (await platformAdmins.POST(req("POST", "/api/admin/platform-admins", { action: "transfer", email: "next@example.test" }))).json();
    expect(body.next).toBe("/");
  });
});

describe("AI credit and the key pool", () => {
  const poolRow = {
    id: "44444444-4444-4444-8444-444444444444",
    provider: "anthropic",
    label: "Main Anthropic",
    envName: null,
    enabled: true,
    priority: 1,
    lastUsedAt: null,
    degradedAt: "2026-10-11T10:00:00Z",
    degradedReason: "Rate limited by the provider (429)",
    // What a careless SELECT * would bring back: it must never reach the response.
    keyCiphertext: "c2VjcmV0LWNpcGhlcnRleHQ=",
    encryptedDek: "ZGVr",
  };

  it("lists the pool without any key material", async () => {
    signIn({ admin: true });
    state.respond = (sql) => {
      if (sql.includes("to_regclass('public.ai_credit_gifts')")) return { rows: [{ ready: true }], rowCount: 1 };
      if (sql.includes("FROM platform_provider_keys k")) return { rows: [poolRow], rowCount: 1 };
      return undefined;
    };
    const response = await aiKeys.GET();
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).toContain("Main Anthropic");
    expect(text).not.toContain("c2VjcmV0LWNpcGhlcnRleHQ=");
    expect(text).not.toContain("ZGVr");
    expect(JSON.parse(text).keys[0]).toMatchObject({ family: "claude", source: "vault", degradedReason: "Rate limited by the provider (429)" });
  });

  it("refuses a gift the pool can't pay for, with what to add", async () => {
    signIn({ admin: true });
    state.respond = (sql) => (sql.includes("to_regclass") ? { rows: [{ ready: true }], rowCount: 1 } : undefined);
    const response = await aiCredits.POST(req("POST", "/api/admin/ai-credits", { orgId: ORG, family: "claude" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/No Claude Sonnet 5.5 and Opus 5.5 key is switched on/);
    expect(state.queries.some((q) => q.sql.includes("grant_ai_credit_gift"))).toBe(false);
  });

  it("gives $10 of Claude by default when a pool key can pay", async () => {
    signIn({ admin: true });
    state.respond = (sql) => {
      if (sql.includes("to_regclass")) return { rows: [{ ready: true }], rowCount: 1 };
      if (sql.includes("FROM platform_provider_keys k")) return { rows: [poolRow], rowCount: 1 };
      if (sql.includes("grant_ai_credit_gift")) return { rows: [{ id: OTHER }], rowCount: 1 };
      return undefined;
    };
    const response = await aiCredits.POST(req("POST", "/api/admin/ai-credits", { orgId: ORG }));
    expect(response.status).toBe(201);
    const call = state.queries.find((q) => q.sql.includes("grant_ai_credit_gift"))!;
    expect(call.params).toEqual([ORG, "claude", "10.00", null, null]);
  });

  it("only accepts provider-key env names for the pool", async () => {
    signIn({ admin: true });
    const response = await aiKeys.POST(req("POST", "/api/admin/ai-keys", { family: "claude", label: "Sneaky", envName: "BETTER_AUTH_SECRET" }));
    expect(response.status).toBe(400);
    expect(state.queries.some((q) => q.sql.includes("INSERT INTO platform_provider_keys"))).toBe(false);
  });
});

describe("module health route", () => {
  it("lists modules for an admin and 404s an unknown module", async () => {
    signIn({ admin: true });
    const list = await (await health.GET(req("GET", "/api/admin/health"))).json();
    expect(list.modules.map((m: { id: string }) => m.id)).toContain("database");
    expect(Object.keys(list.summary).sort()).toEqual(["degraded", "down", "healthy", "not_set_up"]);
    const unknown = await health.GET(req("GET", "/api/admin/health?module=nope"));
    expect(unknown.status).toBe(404);
  });
});
