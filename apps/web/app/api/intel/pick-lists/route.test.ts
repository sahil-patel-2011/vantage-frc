import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const fake = vi.hoisted(() => ({ request: vi.fn(), lead: vi.fn(), query: vi.fn(), save: vi.fn(), read: vi.fn(), ensure: vi.fn(), add: vi.fn(), influence: vi.fn() }));
vi.mock("../../../../lib/intel-auth", () => ({ withIntelRequest: fake.request, intelErrorResponse: () => Response.json({ error: "Request failed" }, { status: 503 }) }));
vi.mock("@vantage/intel-research/repository", () => ({ IntelResearchRepository: vi.fn() }));
vi.mock("@vantage/scouting/permissions", () => ({ assertScoutingLead: fake.lead }));
vi.mock("../../../../lib/scouting/pick-feedback", () => ({ recordPickListInfluence: fake.influence }));
vi.mock("@vantage/db", () => ({ withSavepoint: async (_client: unknown, work: () => Promise<unknown>) => work() }));
vi.mock("../../../../lib/picklist", () => ({
  saveRankedPickList: fake.save, listPickList: fake.read, ensurePickList: fake.ensure, upsertEntryFromTier: fake.add,
  PickListSaveConflict: class extends Error { readonly status = 409; },
}));

const orgId = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const body = { orgId, id, eventKey: "2026test", name: "Final picks", expectedRevision: 4, entries: [{ teamKey: "frc6925", rank: 1, tier: "first" }] };
const request = (value: unknown, headers = {}) => new Request("https://vantage.example/api/intel/pick-lists", {
  method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(value),
});
beforeEach(() => {
  vi.resetAllMocks();
  fake.request.mockImplementation(async (_org, work) => work({ query: fake.query }));
  fake.query.mockResolvedValue({ rows: [{ id: "lead" }], rowCount: 1 });
  fake.save.mockResolvedValue(id); fake.ensure.mockResolvedValue(id);
  fake.influence.mockResolvedValue({ attributed: 0, notified: 0 });
  fake.read.mockResolvedValue({ list: { id, name: "Final picks", eventKey: "2026test", revision: 5, status: "open", updatedAt: null }, entries: [] });
});
describe("pick-list mutation boundaries", () => {
  it("checks scouting authority before reading an actor or changing a list", async () => {
    fake.lead.mockRejectedValue(Object.assign(new Error("Denied"), { status: 403 }));
    expect((await POST(request(body))).status).toBe(403);
    expect(fake.query).not.toHaveBeenCalled(); expect(fake.save).not.toHaveBeenCalled(); expect(fake.add).not.toHaveBeenCalled();
  });
  it("requires a baseline for a full existing-list save", async () => {
    expect((await POST(request({ ...body, expectedRevision: undefined }))).status).toBe(409);
    expect(fake.save).not.toHaveBeenCalled();
  });
  it("keeps the historical one-team shortcut additive", async () => {
    const response = await POST(request({ ...body, id: undefined, expectedRevision: undefined, entries: [{ teamKey: "frc6925", rank: 1, tier: "review" }] }));
    expect(response.status).toBe(201);
    expect(fake.ensure).toHaveBeenCalled(); expect(fake.add).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ pickListId: id, teamKey: "frc6925", tier: "review" }));
    expect(fake.save).not.toHaveBeenCalled();
  });
  it("acknowledges the confirmed revision without a cacheable response", async () => {
    const response = await POST(request(body));
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ id, pickList: { id, revision: 5, status: "open" } });
    expect(fake.lead.mock.invocationCallOrder[0]).toBeLessThan(fake.save.mock.invocationCallOrder[0]!);
  });
  it("does not demote an already-ranked team when the analysis shortcut is repeated", async () => {
    fake.read.mockResolvedValue({ list: { id, name: "Final picks", eventKey: "2026test", revision: 5, status: "open", updatedAt: null },
      entries: [{ id: "entry", teamKey: "frc6925", rank: 3, tier: "first", bucket: "first_pick", notes: "Existing discussion" }] });
    const response = await POST(request({ ...body, id: undefined, expectedRevision: undefined, entries: [{ teamKey: "frc6925", rank: 1, tier: "review" }] }));
    expect(response.status).toBe(201);
    expect(fake.add).not.toHaveBeenCalled(); expect(fake.save).not.toHaveBeenCalled();
    expect(fake.influence).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ entries: [expect.objectContaining({ teamKey: "frc6925", rank: 3, tier: "first" })] }));
  });
  it("does not report success when the saved list cannot be read back", async () => {
    fake.read.mockResolvedValue(null);
    expect((await POST(request(body))).status).toBe(503);
  });
  it("rejects cross-site requests before entering the database boundary", async () => {
    expect((await POST(request(body, { origin: "https://another.example" }))).status).toBe(403);
    expect(fake.request).not.toHaveBeenCalled();
  });
});
