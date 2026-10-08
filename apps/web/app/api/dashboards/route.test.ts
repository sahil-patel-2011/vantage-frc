import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST, DELETE } from "./route";

const fake = vi.hoisted(() => ({ session: vi.fn(), policy: vi.fn(), withRls: vi.fn(), hydrate: vi.fn(), snapshot: vi.fn() }));
vi.mock("@vantage/core", () => ({ assertOrgAuthentication: fake.policy, auth: { api: { getSession: fake.session } } }));
vi.mock("@vantage/db", () => ({ withRls: fake.withRls }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
vi.mock("../../../lib/reference/hydrate-active-event", () => ({ hydrateOrgActiveEvent: fake.hydrate }));
vi.mock("../../../lib/dashboard/snapshot", () => ({ loadDashboardSnapshot: fake.snapshot }));

const orgId = "186677b7-122c-4d11-9978-a2845d3df048";
const boardId = "1e00bb61-8d64-4fb4-a9ce-f64451207962";
const mutation = (method: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://vantage.example/api/dashboards", { method, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.resetAllMocks();
  fake.session.mockResolvedValue({ user: { id: "user-1" }, session: { id: "session-1", authMethod: "password" } });
  fake.policy.mockResolvedValue({});
  fake.hydrate.mockResolvedValue({});
});

describe("dashboard request boundaries", () => {
  it("returns private 401 responses for signed-out reads and mutations", async () => {
    fake.session.mockResolvedValue(null);
    for (const response of [
      await GET(new Request(`https://vantage.example/api/dashboards?orgId=${orgId}`)),
      await POST(mutation("POST", { orgId, action: "create" })),
      await DELETE(mutation("DELETE", { orgId, id: boardId })),
    ]) {
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toContain("no-store");
    }
    expect(fake.withRls).not.toHaveBeenCalled();
  });

  it("returns 403 when a former member reads Home, allowing the client to clear its cache", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    fake.withRls.mockImplementation(async (_scope, callback) => callback({ query }));
    const response = await GET(new Request(`https://vantage.example/api/dashboards?orgId=${orgId}&mode=home`));
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(query).toHaveBeenCalledTimes(1);
    expect(fake.snapshot).not.toHaveBeenCalled();
    expect(fake.hydrate).not.toHaveBeenCalled();
  });

  it("honors team sign-in policy before refreshes, reads, or board mutations", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ role: "owner" }], rowCount: 1 });
    fake.withRls.mockImplementation(async (_scope, callback) => callback({ query }));
    fake.policy.mockRejectedValue(new Error("Authenticator verification is required to enter this organization."));
    const responses = [
      await GET(new Request(`https://vantage.example/api/dashboards?orgId=${orgId}&mode=home`)),
      await POST(mutation("POST", { orgId, action: "create" })),
      await DELETE(mutation("DELETE", { orgId, id: boardId })),
    ];
    for (const response of responses) {
      expect(response.status).toBe(403);
      expect(response.headers.get("cache-control")).toContain("no-store");
    }
    expect(query).toHaveBeenCalledTimes(3); // Membership checks only.
    expect(fake.policy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      userId: "user-1", orgId, sessionId: "session-1", authMethod: "password",
    }));
    expect(fake.hydrate).not.toHaveBeenCalled();
    expect(fake.snapshot).not.toHaveBeenCalled();
  });

  it("rejects cross-site board writes before persistence", async () => {
    for (const response of [
      await POST(mutation("POST", { orgId, action: "create" }, { origin: "https://other.example" })),
      await DELETE(mutation("DELETE", { orgId, id: boardId }, { "sec-fetch-site": "cross-site" })),
    ]) expect(response.status).toBe(403);
    expect(fake.withRls).not.toHaveBeenCalled();
  });

  it("rejects invalid identities and oversized layouts before persistence", async () => {
    const invalidRead = await GET(new Request("https://vantage.example/api/dashboards?orgId=not-a-team&mode=home"));
    expect(invalidRead.status).toBe(400);
    expect((await POST(mutation("POST", { orgId: "another-team", action: "create" }))).status).toBe(400);
    expect((await DELETE(mutation("DELETE", { orgId, id: "wrong-board" }))).status).toBe(400);
    expect((await POST(mutation("POST", { orgId, action: "save", layout: "x".repeat(262_144) }))).status).toBe(413);
    expect(fake.withRls).not.toHaveBeenCalled();
    expect(fake.hydrate).not.toHaveBeenCalled();
  });
});
