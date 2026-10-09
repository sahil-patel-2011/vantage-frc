import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const fake = vi.hoisted(() => ({ session: vi.fn(), policy: vi.fn(), rls: vi.fn(), desk: vi.fn(), health: vi.fn() }));
vi.mock("@vantage/core", () => ({ auth: { api: { getSession: fake.session } }, assertOrgAuthentication: fake.policy }));
vi.mock("@vantage/db", () => ({ withRls: fake.rls }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
vi.mock("../../../../lib/reference-health", () => ({ loadDataSourceHealth: fake.health }));
vi.mock("../../../../lib/strategy/pick-desk", () => ({ loadPickDesk: fake.desk }));
const org = "11111111-1111-4111-8111-111111111111";
const request = (orgId = org) => new Request(`https://vantage.example/api/strategy/pick-desk?orgId=${orgId}`);
beforeEach(() => {
  vi.resetAllMocks();
  fake.session.mockResolvedValue({ user: { id: "user" }, session: { id: "session", authMethod: "password" } });
  fake.rls.mockImplementation(async (_context, work) => work({}));
  fake.desk.mockResolvedValue({ orgId: org, eventKey: "2026test", candidates: [], pickLists: [] });
});
describe("pick desk access and availability", () => {
  it("keeps temporary failures distinct from setup and sign-out", async () => {
    fake.desk.mockRejectedValue(new Error("Database unavailable"));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("status", "setup_required");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("rejects a departed member instead of returning a setup screen", async () => {
    fake.desk.mockResolvedValue({ status: "setup_required", orgId: null, eventKey: null });
    expect((await GET(request())).status).toBe(403);
    expect(fake.health).not.toHaveBeenCalled();
  });
  it("does not return scouting data when team authentication requirements are unmet", async () => {
    fake.policy.mockRejectedValue(new Error("Second factor required"));
    expect((await GET(request())).status).toBe(403);
    expect(fake.health).not.toHaveBeenCalled();
  });
  it("rejects invalid team identifiers before entering the data layer", async () => {
    expect((await GET(request("invalid"))).status).toBe(400);
    expect(fake.rls).not.toHaveBeenCalled();
  });
});
