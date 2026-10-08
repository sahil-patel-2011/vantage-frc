import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const fake = vi.hoisted(() => ({ session: vi.fn(), query: vi.fn(), rls: vi.fn(), proofs: vi.fn() }));
vi.mock("@vantage/core", () => ({ auth: { api: { getSession: fake.session } }, isPlatformAdmin: async () => false }));
vi.mock("@vantage/db", () => ({ withRls: fake.rls }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("../../../lib/connectors/load-connector-status", () => ({ loadConnectorProofs: fake.proofs, buildConnectorStatuses: () => [], summarizeConnectors: () => "No connections" }));

const orgId = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  vi.resetAllMocks();
  fake.session.mockResolvedValue({ user: { id: "member" } });
  fake.rls.mockImplementation(async (_scope, callback) => callback({ query: fake.query }));
  fake.query.mockResolvedValue({ rows: [] });
  fake.proofs.mockResolvedValue({});
});
describe("team connection reads", () => {
  it("refuses a revoked selected team instead of falling back to another team", async () => {
    const response = await GET(new Request(`https://vantage.example/api/connectors?orgId=${orgId}`));
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(fake.query).toHaveBeenCalledWith(expect.any(String), ["member", orgId]);
    expect(fake.proofs).not.toHaveBeenCalled();
  });
  it("resolves the requested team before reading its connections", async () => {
    fake.query.mockResolvedValue({ rows: [{ orgId, role: "owner" }] });
    const response = await GET(new Request(`https://vantage.example/api/connectors?orgId=${orgId}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ orgId, canManage: true });
    expect(fake.proofs).toHaveBeenCalledWith(expect.anything(), { userId: "member", orgId });
  });
  it("does not read private connections for a signed-out visitor", async () => {
    fake.session.mockResolvedValue(null);
    const response = await GET(new Request("https://vantage.example/api/connectors"));
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(fake.rls).not.toHaveBeenCalled();
  });
});
