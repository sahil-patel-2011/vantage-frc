import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
const fake = vi.hoisted(() => ({ query: vi.fn(), request: vi.fn(), session: vi.fn(), policy: vi.fn(), lead: vi.fn(), compute: vi.fn(), create: vi.fn(), add: vi.fn(), vote: vi.fn(), order: vi.fn(), remove: vi.fn(), status: vi.fn() }));
vi.mock("@vantage/core", () => ({ auth: { api: { getSession: fake.session } }, assertOrgAuthentication: fake.policy }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
vi.mock("@vantage/db", () => ({ withRls: fake.request }));
vi.mock("../../../lib/intel-auth", () => ({ withIntelRequest: fake.request, IntelHttpError: class extends Error { constructor(readonly status: number, message: string) { super(message); } } }));
vi.mock("@vantage/scouting/permissions", () => ({ assertScoutingLead: fake.lead }));
vi.mock("../../../lib/picklist", () => ({ PickListSaveConflict: class extends Error { readonly status = 409; }, setEntryNotes: vi.fn() }));
vi.mock("../../../lib/picklist-collab/compute-picklist-collab", () => ({ computePicklistCollabView: fake.compute, createList: fake.create, currentSeasonYear: () => 2026,
  addEntry: fake.add, castVote: fake.vote, setEntryOrder: fake.order, deleteEntry: fake.remove, updateListStatus: fake.status, moveEntry: vi.fn(), removeVote: vi.fn() }));
const orgId = "11111111-1111-4111-8111-111111111111";
const listId = "22222222-2222-4222-8222-222222222222";
const entryId = "33333333-3333-4333-8333-333333333333";
const request = (payload: Record<string, unknown>) => new Request("https://vantage.example/api/picklist-collab", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgId, listId, expectedRevision: 4, ...payload }) });
beforeEach(() => {
  vi.resetAllMocks();
  fake.request.mockImplementation(async (_scope, work) => work({ query: fake.query }));
  fake.session.mockResolvedValue({ user: { id: "member" }, session: { id: "session" } });
  fake.query.mockImplementation(async (sql: string) => sql.includes("current_app_user_id") ? { rows: [{ id: "member" }], rowCount: 1 }
    : sql.includes("SELECT status,revision") ? { rows: [{ status: "open", revision: "4" }], rowCount: 1 } : { rows: [{}], rowCount: 1 });
  fake.compute.mockResolvedValue({ status: "live", orgId, activeList: { id: listId } });
  fake.create.mockResolvedValue(listId);
});
describe("discussion permissions and persistence", () => {
  it("denies rank changes by an ordinary member before changing the list", async () => {
    fake.lead.mockRejectedValue(Object.assign(new Error("Denied"), { status: 403 }));
    expect((await POST(request({ action: "delete-entry", entryId }))).status).toBe(403);
    expect(fake.remove).not.toHaveBeenCalled();
  });
  it("lets an authorized member vote as themselves without scouting management", async () => {
    const response = await POST(request({ action: "cast-vote", entryId, weight: 2 }));
    expect(response.status).toBe(200); expect(fake.lead).not.toHaveBeenCalled();
    expect(fake.vote).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: "member", listId, weight: 2 }));
  });
  it("refuses a stale saved order before writing ranks", async () => {
    expect((await POST(request({ action: "set-order", expectedRevision: 3, order: [{ tier: "first_pick", entryIds: [entryId] }] }))).status).toBe(409);
    expect(fake.order).not.toHaveBeenCalled();
  });
  it("does not allow votes to mutate a locked list", async () => {
    fake.query.mockImplementation(async (sql: string) => sql.includes("current_app_user_id") ? { rows: [{ id: "member" }], rowCount: 1 } : { rows: [{ status: "locked", revision: 4 }], rowCount: 1 });
    expect((await POST(request({ action: "cast-vote", entryId }))).status).toBe(409); expect(fake.vote).not.toHaveBeenCalled();
  });
  it("rejects an entry from a different list", async () => {
    fake.query.mockImplementation(async (sql: string) => sql.includes("current_app_user_id") ? { rows: [{ id: "member" }], rowCount: 1 }
      : sql.includes("SELECT status,revision") ? { rows: [{ status: "open", revision: 4 }], rowCount: 1 } : { rows: [], rowCount: 0 });
    expect((await POST(request({ action: "cast-vote", entryId }))).status).toBe(404); expect(fake.vote).not.toHaveBeenCalled();
  });
  it("opens the newly created list instead of returning the previous list", async () => {
    const nextId = "44444444-4444-4444-8444-444444444444";
    fake.create.mockResolvedValue(nextId); fake.compute.mockResolvedValue({ status: "live", orgId, activeList: { id: nextId } });
    const response = await POST(request({ action: "create-list", name: "Final picks", eventKey: "2026test" }));
    expect(response.status).toBe(200); expect(fake.compute).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ listId: nextId }));
  });
  it("checks authentication policy and returns failures without a setup success", async () => {
    fake.policy.mockRejectedValue(new Error("Second factor required"));
    expect((await GET(new Request(`https://vantage.example/api/picklist-collab?orgId=${orgId}`))).status).toBe(403);
    fake.policy.mockReset(); fake.compute.mockRejectedValue(new Error("Offline"));
    const response = await GET(new Request(`https://vantage.example/api/picklist-collab?orgId=${orgId}`));
    expect(response.status).toBe(503); expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
