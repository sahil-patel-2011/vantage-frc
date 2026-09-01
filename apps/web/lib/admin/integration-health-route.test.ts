import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Privilege-gate contract for GET /api/admin/integration-health. `assertPlatformAdmin` /
 * `isPlatformAdmin` / `platformAdminDeniedResponse` are used for real (imported via
 * `vi.importActual`) so this test exercises the actual fail-closed logic, not a
 * reimplementation of it. Only `auth.api.getSession`, `withRls`, and the loader are
 * stubbed — this is a privilege-gate test, not a re-test of the loader's SQL (that
 * lives in integration-health.test.ts against the pure classifier).
 */
const state = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  isPlatformAdmin: false,
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
      query: async (sql: string) => {
        if (sql.includes("is_platform_admin")) {
          return { rows: [{ allowed: state.isPlatformAdmin }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    }),
}));

vi.mock("./load-integration-health", () => ({
  loadIntegrationHealth: async () => ({
    generatedAt: "2026-08-31T12:00:00.000Z",
    summary: { healthy: 1, configured: 0, degraded: 0, setup_required: 0, error: 0 },
    checks: [],
  }),
}));

const { GET } = await import("../../app/api/admin/integration-health/route");

beforeEach(() => {
  state.session = null;
  state.isPlatformAdmin = false;
});

describe("GET /api/admin/integration-health privilege gate", () => {
  it("returns 401 when there is no session", async () => {
    const response = await GET();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Authentication required" });
  });

  it("returns 404 (not 403) for a signed-in caller who is not a platform admin", async () => {
    state.session = { user: { id: "11111111-1111-4111-8111-111111111111" } };
    state.isPlatformAdmin = false;
    const response = await GET();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
  });

  it("returns 200 with the loader payload for a platform admin", async () => {
    state.session = { user: { id: "11111111-1111-4111-8111-111111111111" } };
    state.isPlatformAdmin = true;
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    const body = await response.json();
    expect(body.summary.healthy).toBe(1);
    expect(body.checks).toEqual([]);
  });
});
