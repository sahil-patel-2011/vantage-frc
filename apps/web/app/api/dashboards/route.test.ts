import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST, DELETE } from "./route";

const fake = vi.hoisted(() => ({ session: vi.fn(), withRls: vi.fn(), hydrate: vi.fn(), snapshot: vi.fn() }));
vi.mock("@vantage/core", () => ({ auth: { api: { getSession: fake.session } } }));
vi.mock("@vantage/db", () => ({ withRls: fake.withRls }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("../../../lib/reference/hydrate-active-event", () => ({ hydrateOrgActiveEvent: fake.hydrate }));
vi.mock("../../../lib/dashboard/snapshot", () => ({ loadDashboardSnapshot: fake.snapshot }));

const orgId = "186677b7-122c-4d11-9978-a2845d3df048";
const boardId = "1e00bb61-8d64-4fb4-a9ce-f64451207962";
const mutation = (method: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://vantage.example/api/dashboards", { method, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.resetAllMocks();
  fake.session.mockResolvedValue({ user: { id: "user-1" } });
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
  });

  it("rejects cross-site board writes before persistence", async () => {
    for (const response of [
      await POST(mutation("POST", { orgId, action: "create" }, { origin: "https://other.example" })),
      await DELETE(mutation("DELETE", { orgId, id: boardId }, { "sec-fetch-site": "cross-site" })),
    ]) expect(response.status).toBe(403);
    expect(fake.withRls).not.toHaveBeenCalled();
  });

  it("rejects invalid identities and oversized layouts before persistence", async () => {
    expect((await POST(mutation("POST", { orgId: "another-team", action: "create" }))).status).toBe(400);
    expect((await DELETE(mutation("DELETE", { orgId, id: "wrong-board" }))).status).toBe(400);
    expect((await POST(mutation("POST", { orgId, action: "save", layout: "x".repeat(262_144) }))).status).toBe(413);
    expect(fake.withRls).not.toHaveBeenCalled();
  });
});
