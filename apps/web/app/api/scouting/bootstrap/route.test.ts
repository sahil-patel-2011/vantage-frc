import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
const fake = vi.hoisted(() => ({ session: vi.fn(), policy: vi.fn(), query: vi.fn(), bootstrap: vi.fn(), available: true }));
vi.mock("@vantage/core", () => ({ auth: { api: { getSession: fake.session } }, assertOrgAuthentication: fake.policy }));
vi.mock("@vantage/db", () => ({ withRls: async (_scope: unknown, work: (client: unknown) => Promise<unknown>) => work({ query: fake.query }) }));
vi.mock("@vantage/scouting/repository", () => ({ ScoutingRepository: class { bootstrap = fake.bootstrap; } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
const orgId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const eventKey = "2026txho";
const request = (extra = {}) => new Request(`https://vantage.example/api/scouting/bootstrap?${new URLSearchParams({ orgId, ...extra })}`);
beforeEach(() => {
  vi.resetAllMocks(); fake.available = true;
  fake.session.mockResolvedValue({ user: { id: userId }, session: { id: "session" } });
  fake.query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM memberships")) return { rows: [{}], rowCount: 1 };
    if (sql.includes("FROM events_ref")) return { rows: fake.available ? [{ eventKey, eventName: "Linked event" }] : [], rowCount: fake.available ? 1 : 0 };
    return { rows: [], rowCount: 0 };
  });
  fake.bootstrap.mockImplementation(async (_org: string, _user: string, selected?: { eventKey: string; eventName: string }) => ({
    eventKey: selected?.eventKey ?? "2026txda", eventName: selected?.eventName ?? "Active event", matches: [], schemas: [], assignments: [], recentEntries: [],
  }));
});
describe("scouting bootstrap event handoff", () => {
  it("passes a validated linked event without mutating the team context", async () => {
    const response = await GET(request({ eventKey }));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ eventKey, eventName: "Linked event" });
    expect(fake.bootstrap).toHaveBeenCalledWith(orgId, userId, { eventKey, eventName: "Linked event" });
    expect(fake.query.mock.calls.some(([sql]) => /UPDATE|INSERT|DELETE/.test(String(sql)))).toBe(false);
    const membership = fake.query.mock.calls.findIndex(([sql]) => String(sql).includes("FROM memberships"));
    const selected = fake.query.mock.calls.findIndex(([sql]) => String(sql).includes("FROM events_ref"));
    expect(selected).toBeGreaterThan(membership);
  });
  it("retains active-event behavior for existing callers and refuses a missing explicit event", async () => {
    expect((await GET(request())).status).toBe(200);
    expect(fake.bootstrap).toHaveBeenCalledWith(orgId, userId, undefined);
    fake.bootstrap.mockClear(); fake.available = false;
    expect((await GET(request({ eventKey }))).status).toBe(404);
    expect(fake.bootstrap).not.toHaveBeenCalled();
  });
  it("checks team authentication policy and hides unavailable persistence details", async () => {
    fake.policy.mockRejectedValue(Object.assign(new Error("Authenticator verification required"), { code: "mfa_step_up_required" }));
    expect((await GET(request({ eventKey }))).status).toBe(403);
    expect(fake.bootstrap).not.toHaveBeenCalled();
    fake.policy.mockRejectedValue(Object.assign(new Error("private SQL detail"), { code: "ECONNREFUSED" }));
    const response = await GET(request()); expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private SQL");
  });
  it("rejects malformed scope before database access", async () => {
    expect((await GET(request({ orgId: "wrong" }))).status).toBe(400);
    expect((await GET(request({ eventKey: "../../other" }))).status).toBe(400);
    expect(fake.query).not.toHaveBeenCalled();
  });
});
