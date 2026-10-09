import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import type { FormulaExpression } from "@vantage/scouting";

const fake = vi.hoisted(() => ({ session: vi.fn(), request: vi.fn(), lead: vi.fn(), query: vi.fn() }));
vi.mock("@vantage/core", () => ({ auth: { api: { getSession: fake.session } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@vantage/scouting/permissions", () => ({ assertScoutingLead: fake.lead }));
vi.mock("../../../../lib/scouting-auth", () => ({ withScoutingRequest: fake.request, scoutingErrorResponse: () => Response.json({ error: "Denied" }, { status: 403 }) }));
const orgId = "11111111-1111-4111-8111-111111111111";
const schemaId = "22222222-2222-4222-8222-222222222222";
const revision = "2026-10-09 12:00:00.123456+00";
const expression = { op: "lookup", field: "climb", values: { L1: 10, none: 0 } };
function request(baseRevision: string | null | undefined, formula: FormulaExpression = { ...expression, op: "lookup" }) {
  return new Request("https://vantage.example/api/scouting/formulas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgId, schemaId, name: "Endgame", expression: formula, baseRevision }) });
}
beforeEach(() => {
  vi.resetAllMocks();
  fake.session.mockResolvedValue({ user: { id: "lead" } });
  fake.request.mockImplementation(async (_org, callback) => callback({ query: fake.query }));
  fake.query.mockResolvedValueOnce({ rows: [{ fields: [{ key: "climb", label: "Climb", type: "select", options: ["L1", "none", "could_not_see"] }] }] })
    .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ revision }] });
});
describe("scoring formula saves", () => {
  it.each([undefined, null, "2026-10-09 12:00:00.123+00"])("rejects an absent, initial or imprecise stale revision: %s", async baseline => {
    expect((await POST(request(baseline))).status).toBe(409);
    expect(fake.query).toHaveBeenCalledTimes(3);
    expect(fake.query.mock.calls.some(([sql]) => sql.includes("INSERT"))).toBe(false);
  });
  it("returns a confirmed revision only after the exact baseline and lead permission are checked", async () => {
    fake.query.mockResolvedValueOnce({ rows: [{ id: "saved", name: "Endgame", expression, revision: "new", updatedAt: "2026-10-09T12:00:01Z" }] });
    const response = await POST(request(revision));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: "saved", revision: "new", expression });
    expect(fake.lead.mock.invocationCallOrder[0]).toBeLessThan(fake.query.mock.invocationCallOrder[0]!);
    expect(fake.query.mock.calls[1]?.[0]).toContain("pg_advisory_xact_lock");
  });
  it("allows an explicitly empty baseline only for the first formula", async () => {
    fake.query.mockReset().mockResolvedValueOnce({ rows: [{ fields: [{ key: "climb", label: "Climb", type: "select", options: ["L1", "none"] }] }] })
      .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: "saved", name: "Endgame", expression, revision }] });
    expect((await POST(request(null))).status).toBe(200);
  });
  it("checks lead permission before reading or writing formulas", async () => {
    fake.lead.mockRejectedValue(new Error("Scouting lead required"));
    expect((await POST(request(revision))).status).toBe(403);
    expect(fake.query).not.toHaveBeenCalled();
  });
  it("refuses unseen answer mappings before taking the write lock", async () => {
    expect((await POST(request(revision, { op: "lookup", field: "climb", values: { could_not_see: 0 } }))).status).toBe(422);
    expect(fake.query).toHaveBeenCalledTimes(1);
  });
});
