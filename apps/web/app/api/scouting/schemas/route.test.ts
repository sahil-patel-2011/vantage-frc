import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const fake = vi.hoisted(() => ({ session: vi.fn(), request: vi.fn(), lead: vi.fn(), lock: vi.fn(), query: vi.fn() }));
vi.mock("@vantage/core", () => ({ auth: { api: { getSession: fake.session } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@vantage/scouting/permissions", () => ({ assertScoutingLead: fake.lead, canManageScouting: vi.fn() }));
vi.mock("@vantage/scouting/repository", () => ({ lockScoutingSchemaVersion: fake.lock, ScoutingRepository: vi.fn() }));
vi.mock("../../../../lib/scouting-auth", () => ({ withScoutingRequest: fake.request, scoutingErrorResponse: () => Response.json({ error: "Denied" }, { status: 403 }) }));

const orgId = "11111111-1111-4111-8111-111111111111";
const currentId = "22222222-2222-4222-8222-222222222222";
const nextId = "33333333-3333-4333-8333-333333333333";
const definition = { title: "Match notes", fields: [{ key: "notes", label: "Notes", type: "text" }] };
function request(baseSchemaId: string | null | undefined) {
  return new Request("https://vantage.example/api/scouting/schemas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgId, year: 2026, type: "match", definition, baseSchemaId }) });
}
beforeEach(() => {
  vi.resetAllMocks();
  fake.session.mockResolvedValue({ user: { id: "lead" } });
  fake.request.mockImplementation(async (_org, callback) => callback({ query: fake.query }));
  fake.query.mockResolvedValueOnce({ rows: [{ id: currentId, version: 4 }], rowCount: 1 });
});
describe("scouting publication concurrency", () => {
  it.each([undefined, null, nextId])("refuses an absent or stale baseline before creating a version: %s", async baseline => {
    const response = await POST(request(baseline));
    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(fake.query).toHaveBeenCalledTimes(1);
    expect(fake.lock).toHaveBeenCalledWith(expect.anything(), orgId, 2026, "match");
  });
  it("publishes from the current version only after taking the publication lock", async () => {
    fake.query.mockResolvedValueOnce({ rows: [{ id: nextId, version: 5 }], rowCount: 1 });
    const response = await POST(request(currentId));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ id: nextId, version: 5, definition });
    expect(fake.lock.mock.invocationCallOrder[0]).toBeLessThan(fake.query.mock.invocationCallOrder[0]!);
  });
  it("allows an explicitly empty baseline for the first form", async () => {
    fake.query.mockReset().mockResolvedValueOnce({ rows: [], rowCount: 0 }).mockResolvedValueOnce({ rows: [{ id: nextId, version: 1 }], rowCount: 1 });
    expect((await POST(request(null))).status).toBe(201);
  });
  it("checks lead permission before reading or writing versions", async () => {
    fake.lead.mockRejectedValue(new Error("Scouting lead required"));
    expect((await POST(request(currentId))).status).toBe(403);
    expect(fake.lock).not.toHaveBeenCalled(); expect(fake.query).not.toHaveBeenCalled();
  });
});
