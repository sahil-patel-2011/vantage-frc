import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../../app/api/organizations/provisioning/route";

const ORG = "22222222-2222-4222-8222-222222222222";
const fake = vi.hoisted(() => ({
  session: { user: { id: "owner" } } as { user: { id: string } } | null,
  query: vi.fn(), rls: vi.fn(), defaults: vi.fn(), start: vi.fn(), getRun: vi.fn(),
}));
vi.mock("@vantage/core", () => ({ auth: { api: { getSession: async () => fake.session } } }));
vi.mock("@vantage/db", () => ({ withRls: fake.rls }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("./defaults", () => ({ initializeTeamDefaults: fake.defaults }));
vi.mock("./start", () => ({ startTeamProvisioning: fake.start }));
vi.mock("workflow/api", () => ({ getRun: fake.getRun }));

const request = () => new Request("https://vantage.test/api/organizations/provisioning", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgId: ORG }),
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_VANTAGE_HOSTED_BACKGROUND_ENABLED", "0");
  fake.session = { user: { id: "owner" } };
  fake.rls.mockImplementation(async (_scope, work) => work({ query: fake.query }));
  fake.query.mockResolvedValue({ rows: [], rowCount: 1 });
  fake.defaults.mockResolvedValue(undefined);
  fake.start.mockResolvedValue(false);
});
afterEach(() => vi.unstubAllEnvs());

describe("team setup response contracts", () => {
  it("does not query or dispatch for an unsigned request", async () => {
    fake.session = null;
    expect((await POST(request())).status).toBe(401);
    expect(fake.rls).not.toHaveBeenCalled();
    expect(fake.start).not.toHaveBeenCalled();
  });

  it("does not initialize defaults or dispatch when the authorized update refuses setup", async () => {
    fake.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect((await POST(request())).status).toBe(409);
    expect(fake.defaults).not.toHaveBeenCalled();
    expect(fake.start).not.toHaveBeenCalled();
  });

  it("returns a usable core workspace without claiming a disabled workflow was accepted", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: false, workspaceReady: true });
    expect(fake.defaults).toHaveBeenCalledWith(expect.anything(), ORG, { inTransaction: true });
  });

  it("acknowledges accepted background dispatch separately from core workspace availability", async () => {
    vi.stubEnv("NEXT_PUBLIC_VANTAGE_HOSTED_BACKGROUND_ENABLED", "1");
    fake.start.mockResolvedValueOnce(true);
    const response = await POST(request());
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: true, workspaceReady: true });
  });

  it("does not contact a hosted run just to display status when background work is disabled", async () => {
    fake.query.mockResolvedValueOnce({ rows: [{ state: "queued", phase: "tools", completedPhases: ["team"], error: null,
      verifiedAt: null, updatedAt: "2026-10-07T12:00:00Z", workflowRunId: "previous-run" }], rowCount: 1 });
    const response = await GET(new Request(`https://vantage.test/api/organizations/provisioning?orgId=${ORG}`));
    expect(response.status).toBe(200);
    expect(await response.json()).not.toHaveProperty("workflowRunId");
    expect(fake.getRun).not.toHaveBeenCalled();
  });
});
