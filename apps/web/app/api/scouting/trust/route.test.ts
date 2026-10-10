import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
import type { FieldDefinition } from "@vantage/scouting";

const fake = vi.hoisted(() => ({ session: vi.fn(), query: vi.fn(), policy: vi.fn(), lead: vi.fn(), fields: null as FieldDefinition[] | null, updatedAt: null as string | null, saved: null as null | { schemaId: string; fieldKey: string; enabled: boolean } }));
vi.mock("@vantage/core", () => ({ auth: { api: { getSession: fake.session } }, assertOrgAuthentication: fake.policy, emitPreferredNotification: vi.fn() }));
vi.mock("@vantage/db", () => ({ withRls: async (_scope: unknown, work: (client: unknown) => Promise<unknown>) => work({ query: fake.query }) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
vi.mock("@vantage/scouting/permissions", () => ({ assertScoutingLead: fake.lead, canManageScouting: async () => true, listScoutingCoordinators: async () => [] }));
const orgId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const schemaId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const userId = "11111111-1111-4111-8111-111111111111";
const eventKey = "2026txho";
const baseline = "2026-10-09 12:00:00+00";
const payload = { orgId, eventKey, action: "set-policy", schemaId, fieldKey: "climb", preferredSource: "consensus", enabled: false, expectedUpdatedAt: baseline };
function post(body: unknown, origin = "https://vantage.example") {
  return new Request("https://vantage.example/api/scouting/trust", { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });
}
const inserted = () => fake.query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO scout_field_policies"));
beforeEach(() => {
  vi.resetAllMocks(); fake.updatedAt = baseline; fake.saved = null; fake.fields = null;
  fake.session.mockResolvedValue({ user: { id: userId }, session: { id: "session" } });
  fake.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("SELECT schema AS definition")) return { rows: [{ type: "match", definition: { title: "Match", fields: fake.fields ?? [{ key: "climb", label: "Climb", type: "select" }] } }], rowCount: 1 };
    if (sql.includes("SELECT updated_at::text")) return { rows: fake.updatedAt ? [{ updatedAt: fake.updatedAt }] : [], rowCount: fake.updatedAt ? 1 : 0 };
    if (sql.includes("INSERT INTO scout_field_policies")) {
      fake.saved = { schemaId: String(params[1]), fieldKey: String(params[2]), enabled: Boolean(params[6]) };
      return { rows: [fake.saved], rowCount: 1 };
    }
    if (sql.includes("FROM memberships")) return { rows: [{ eventKey, role: "admin" }], rowCount: 1 };
    if (sql.includes("SELECT schema_id AS")) return { rows: fake.saved ? [{ ...fake.saved, preferredSource: "consensus", officialKey: null, teamIndexed: false, updatedAt: baseline }] : [], rowCount: 0 };
    return { rows: [], rowCount: 0 };
  });
});
describe("scouting quality permissions and confirmed rule writes", () => {
  it("returns evidence labelled by its original form while keeping aggregate API fields", async () => {
    fake.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM memberships")) return { rows: [{ eventKey, role: "admin" }], rowCount: 1 };
      if (sql.includes("FROM scout_schemas WHERE")) return { rows: [
        { id: userId, year: 2026, type: "match", version: 2, definition: { title: "Match", fields: [{ key: "q_saved", label: "New mobility", type: "boolean", config: { officialComparison: "mobility" } }] } },
        { id: schemaId, year: 2026, type: "match", version: 1, definition: { title: "Original match", fields: [{ key: "q_saved", label: "Original climb", type: "select", config: { officialComparison: "climb" } }] } },
      ], rowCount: 2 };
      if (sql.includes('SELECT e.schema_id AS "schemaId",v.field_key')) return { rows: [{ schemaId, fieldKey: "q_saved", status: "match" }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const response = await GET(new Request(`https://vantage.example/api/scouting/trust?orgId=${orgId}&eventKey=${eventKey}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ fieldTrust: [{ fieldKey: "q_saved", checks: 1 }],
      fieldTrustBySchema: [{ schemaId, label: "Original climb", formTitle: "Original match", version: 1, checks: 1 }] });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("enables custom original-schema outcomes and refuses incompatible or opted-out questions", async () => {
    fake.fields = [{ key: "q_custom", label: "Finish", type: "select", config: { officialComparison: "climb" } }];
    expect((await POST(post({ ...payload, fieldKey: "q_custom", enabled: true }))).status).toBe(200);
    fake.fields = [{ ...fake.fields[0]!, type: "counter" }];
    expect((await POST(post({ ...payload, fieldKey: "q_custom", enabled: true }))).status).toBe(422);
    fake.fields = [{ ...fake.fields[0]!, type: "select", config: { officialComparison: "none" } }];
    expect((await POST(post({ ...payload, fieldKey: "q_custom", enabled: true }))).status).toBe(422);
    expect(fake.query.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO scout_field_policies"))).toHaveLength(1);
  });
  it("blocks cross-site writes before reading team data", async () => {
    expect((await POST(post(payload, "https://other.example"))).status).toBe(403);
    expect(fake.query).not.toHaveBeenCalled();
  });
  it("checks lead permissions before touching a rule", async () => {
    fake.lead.mockRejectedValue(new Error("Scouting lead access required"));
    expect((await POST(post(payload))).status).toBe(403);
    expect(inserted()).toBe(false);
  });
  it("refuses an absent baseline and a competing edit", async () => {
    const { expectedUpdatedAt: _baseline, ...missing } = payload;
    expect((await POST(post(missing))).status).toBe(409);
    expect((await POST(post({ ...payload, expectedUpdatedAt: "older" }))).status).toBe(409);
    expect(inserted()).toBe(false);
  });
  it("refuses a question outside the selected team's original schema", async () => {
    fake.query.mockImplementation(async (sql: string) => ({ rows: sql.includes("FROM memberships") ? [{}] : [], rowCount: sql.includes("FROM memberships") ? 1 : 0 }));
    expect((await POST(post(payload))).status).toBe(404);
    expect(inserted()).toBe(false);
    expect(fake.query).toHaveBeenCalledWith(expect.stringContaining("WHERE org_id=$1::uuid AND id=$2::uuid"), [orgId, schemaId]);
  });
  it("confirms the exact saved question and enabled state in a private response", async () => {
    const response = await POST(post(payload));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ orgId, eventKey, trustResult: { action: "set-policy", schemaId, fieldKey: "climb", enabled: false } });
    const lock = fake.query.mock.calls.findIndex(([sql]) => String(sql).includes("pg_advisory_xact_lock"));
    const write = fake.query.mock.calls.findIndex(([sql]) => String(sql).includes("INSERT INTO scout_field_policies"));
    expect(lock).toBeGreaterThanOrEqual(0); expect(write).toBeGreaterThan(lock);
  });
  it("uses the same rule lock for different spellings of the same schema UUID", async () => {
    const response = await POST(post({ ...payload, schemaId: schemaId.toUpperCase() }));
    expect(response.status).toBe(200);
    expect(fake.query).toHaveBeenCalledWith(expect.stringContaining("pg_advisory_xact_lock"), [`scout-policy:${orgId}:${schemaId}`]);
    expect((await response.json()).trustResult.schemaId).toBe(schemaId);
  });
  it("separates authentication policy denial from an authentication service outage", async () => {
    const request = new Request(`https://vantage.example/api/scouting/trust?orgId=${orgId}&eventKey=${eventKey}`);
    fake.policy.mockRejectedValue(Object.assign(new Error("Authenticator verification required"), { code: "mfa_step_up_required" }));
    expect((await GET(request)).status).toBe(403);
    fake.policy.mockRejectedValue(Object.assign(new Error("private SQL connection detail"), { code: "ECONNREFUSED" }));
    const failure = await GET(request);
    expect(failure.status).toBe(503);
    expect(failure.headers.get("cache-control")).toContain("no-store");
    expect(JSON.stringify(await failure.json())).not.toContain("private SQL");
  });
  it("rejects impossible dates before any meeting seat insert", async () => {
    expect((await POST(post({ orgId, eventKey, action: "seat-top-accurate", seatCount: 3, meetingOn: "2026-02-30" }))).status).toBe(400);
    expect(fake.query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO scout_strategy_seats"))).toBe(false);
  });
});
