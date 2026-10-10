import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { readQualityReportPage } from "../../../../lib/scouting/quality-reports";
const fake = vi.hoisted(() => ({ session: vi.fn(), policy: vi.fn(), query: vi.fn(), member: true, form: true, enabled: true, reports: [] as unknown[] }));
vi.mock("@vantage/core", () => ({ auth: { api: { getSession: fake.session } }, assertOrgAuthentication: fake.policy }));
vi.mock("@vantage/db", () => ({ withRls: async (_scope: unknown, work: (client: unknown) => Promise<unknown>) => work({ query: fake.query }) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
const orgId = "11111111-1111-4111-8111-111111111111";
const schemaId = "22222222-2222-4222-8222-222222222222";
const validationId = "33333333-3333-4333-8333-333333333333";
const checkedAt = "2026-10-09T12:00:00.123456Z";
const input = { orgId, schemaId, eventKey: "2026txho", fieldKey: "q_saved", status: "conflict" };
const request = (extra = {}) => new Request(`https://vantage.example/api/scouting/quality-reports?${new URLSearchParams({ ...input, ...extra })}`);
beforeEach(() => {
  vi.resetAllMocks(); fake.member = true; fake.form = true; fake.enabled = true; fake.reports = [];
  fake.session.mockResolvedValue({ user: { id: orgId }, session: { id: "session" } });
  fake.query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM memberships")) return { rows: fake.member ? [{}] : [], rowCount: fake.member ? 1 : 0 };
    if (sql.includes("FROM scout_schemas")) return { rows: fake.form ? [{ type: "match", definition: { title: "Original", fields: [{ key: "q_saved", label: "Climb", type: "select", config: { officialComparison: "climb" } }] } }] : [], rowCount: fake.form ? 1 : 0 };
    if (sql.includes("FROM scout_field_policies")) return { rows: [{ enabled: fake.enabled }], rowCount: 1 };
    if (sql.includes("FROM scout_entry_validations")) return { rows: fake.reports, rowCount: fake.reports.length };
    return { rows: [], rowCount: 0 };
  });
});
describe("original question report review route", () => {
  it("requires current membership and original tenant-owned question before reading reports", async () => {
    fake.member = false; expect((await GET(request())).status).toBe(403);
    expect(fake.query.mock.calls.some(([sql]) => String(sql).includes("FROM scout_schemas"))).toBe(false);
    fake.member = true; fake.form = false; expect((await GET(request())).status).toBe(404);
    expect(fake.query.mock.calls.some(([sql]) => String(sql).includes("FROM scout_entry_validations"))).toBe(false);
  });
  it("does not return disabled evidence as active quality checks", async () => {
    fake.enabled = false;
    const response = await GET(request());
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ ...input, checkingEnabled: false, reports: [], nextCursor: null });
    expect(fake.query.mock.calls.some(([sql]) => String(sql).includes("FROM scout_entry_validations"))).toBe(false);
  });
  it("bounds the page, scopes evidence and preserves the exact next cursor", async () => {
    fake.reports = Array.from({ length: 26 }, (_, index) => ({ validationId: index === 24 ? validationId : `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      entryId: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`, checkedAt, updatedAt: checkedAt,
      matchKey: `2026txho_qm${index + 1}`, teamKey: "frc6925", scoutName: "Scout", source: "manual", status: "conflict", scoutValue: false, officialValue: "DeepCage" }));
    const response = await GET(request({ beforeCheckedAt: checkedAt, beforeValidationId: validationId }));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    const body = await response.json(); expect(body.reports).toHaveLength(25); expect(body.nextCursor).toEqual({ checkedAt, validationId });
    expect(readQualityReportPage(body, { ...input, status: "conflict" })?.reports).toHaveLength(25);
    const call = fake.query.mock.calls.find(([sql]) => String(sql).includes("FROM scout_entry_validations"))!;
    expect(call[1]).toEqual([orgId, input.eventKey, schemaId, input.fieldKey, "conflict", checkedAt, validationId, 26]);
    expect(call[0]).toContain("e.org_id=v.org_id"); expect(call[0]).toContain("[robot-check-v3]");
    expect(call[0]).toContain("(v.checked_at,v.id)<");
  });
  it("separates authentication policy denial from unavailable storage", async () => {
    fake.policy.mockRejectedValue(Object.assign(new Error("Authenticator verification required"), { code: "mfa_step_up_required" }));
    expect((await GET(request())).status).toBe(403);
    fake.policy.mockRejectedValue(Object.assign(new Error("private SQL detail"), { code: "ECONNREFUSED" }));
    const response = await GET(request()); expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private SQL");
  });
  it("rejects invalid and incomplete cursors before persistence reads", async () => {
    expect((await GET(request({ beforeValidationId: validationId }))).status).toBe(400);
    expect(fake.query).not.toHaveBeenCalled();
  });
});
