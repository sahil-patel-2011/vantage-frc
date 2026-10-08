import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { IntelHttpError } from "../../../../../lib/intel-auth";

const fake = vi.hoisted(() => ({ session: vi.fn(), guard: vi.fn(), pool: vi.fn(), connect: vi.fn(),
  query: vi.fn(), release: vi.fn(), audit: vi.fn(), encrypt: vi.fn() }));
vi.mock("../../../../../lib/intel-auth", () => ({ intelSession: fake.session, withIntelRequest: fake.guard,
  IntelHttpError: class extends Error { constructor(readonly status: number, message: string) { super(message); } },
}));
vi.mock("@vantage/db/cad-relay", () => ({ getCadRelayPool: fake.pool }));
vi.mock("@vantage/db", () => ({ withRls: fake.audit }));
vi.mock("@vantage/billing", () => ({ createKms: () => ({}), encryptSecret: fake.encrypt }));

const orgId = "00000000-0000-4000-8000-000000000001";
const deviceId = "00000000-0000-4000-8000-000000000002";
const body = { code: "abcd-efgh", orgId, platform: "onshape" };
const request = (data: unknown = body, origin = "https://vantage.example") => new Request("https://vantage.example/api/cad/pair/approve", {
  method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(data),
});
let requestedPlatform: string | null;
beforeEach(() => {
  vi.resetAllMocks();
  requestedPlatform = "onshape";
  fake.session.mockResolvedValue({ user: { id: "actor" } });
  fake.guard.mockResolvedValue(undefined);
  fake.pool.mockReturnValue({ connect: fake.connect });
  fake.connect.mockResolvedValue({ query: fake.query, release: fake.release });
  fake.encrypt.mockResolvedValue({ ciphertext: "encrypted-only" });
  fake.audit.mockResolvedValue(undefined);
  fake.query.mockImplementation(async (sql: string) => {
    if (sql.startsWith("SELECT")) return { rows: [{ id: "pair-id", machine_name: "My CAD laptop", cli_version: "0.1.1", requested_platform: requestedPlatform }] };
    if (sql.startsWith("INSERT")) return { rows: [{ id: deviceId }] };
    return { rows: [], rowCount: 1 };
  });
});

describe("CAD device approval boundaries", () => {
  it("rejects cross-site, malformed, oversized and non-enum input before privileged IO", async () => {
    expect((await POST(request(body, "https://other.example"))).status).toBe(403);
    for (const data of [{ ...body, platform: "other" }, { ...body, code: "1234-5678" }, { ...body, userId: "forged" }, { ...body, orgId: "bad" }]) {
      expect((await POST(request(data))).status).toBe(400);
    }
    expect((await POST(request({ ...body, code: "x".repeat(3000) }))).status).toBe(413);
    expect(fake.pool).not.toHaveBeenCalled();
  });

  it("authenticates and checks team policy before allocating any relay connection", async () => {
    fake.session.mockRejectedValueOnce(new IntelHttpError(401, "Authentication required"));
    expect((await POST(request())).status).toBe(401);
    fake.guard.mockRejectedValueOnce(new IntelHttpError(403, "Organization access denied"));
    expect((await POST(request())).status).toBe(403);
    expect(fake.pool).not.toHaveBeenCalled();
    expect(fake.guard).toHaveBeenCalledWith(orgId, expect.any(Function));
  });

  it("returns private setup/unavailable errors when pool creation or connection fails", async () => {
    fake.pool.mockImplementationOnce(() => { throw new Error("DATABASE_CAD_RELAY_URL is required"); });
    const setup = await POST(request());
    expect(setup.status).toBe(503);
    expect(await setup.json()).toMatchObject({ missingEnv: ["DATABASE_CAD_RELAY_URL"] });
    fake.connect.mockRejectedValueOnce(new Error("private database endpoint details"));
    const unavailable = await POST(request());
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get("cache-control")).toContain("no-store");
    expect(await unavailable.text()).not.toContain("private database");
    expect(fake.query).not.toHaveBeenCalled();
  });

  it("keeps credentials server-side and commits Onshape monitoring scopes after a locked code lookup", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, machineName: "My CAD laptop" });
    expect(fake.query).toHaveBeenCalledWith(expect.stringContaining("FOR UPDATE"), [createHash("sha256").update("ABCDEFGH").digest("hex")]);
    const insert = fake.query.mock.calls.find(([sql]) => String(sql).startsWith("INSERT"))!;
    expect(insert[1]).toEqual([orgId, "actor", "My CAD laptop", "onshape", expect.stringMatching(/^[a-f0-9]{64}$/), ["cad.jobs.monitor"], "0.1.1"]);
    expect(fake.query).toHaveBeenCalledWith("COMMIT");
    expect(fake.query).not.toHaveBeenCalledWith("ROLLBACK");
    expect(fake.release).toHaveBeenCalledTimes(1);
  });

  it("preserves legacy Fusion approvals and rejects mismatched platform-specific connectors", async () => {
    requestedPlatform = null;
    expect((await POST(request({ ...body, platform: "fusion360" }))).status).toBe(200);
    expect(fake.query.mock.calls.find(([sql]) => String(sql).startsWith("INSERT"))![1][5]).toEqual(["cad.jobs.claim", "cad.jobs.progress", "cad.artifacts.upload"]);
    fake.query.mockClear(); requestedPlatform = "onshape";
    expect((await POST(request({ ...body, platform: "fusion360" }))).status).toBe(409);
    expect(fake.query).toHaveBeenCalledWith("ROLLBACK");
    expect(fake.query.mock.calls.some(([sql]) => String(sql).startsWith("INSERT"))).toBe(false);
  });

  it("reports committed approval truthfully when only the tenant audit fails", async () => {
    fake.audit.mockRejectedValueOnce(new Error("private audit details"));
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, warning: "audit_unavailable" });
    expect(fake.query).toHaveBeenCalledWith("COMMIT");
    expect(fake.query).not.toHaveBeenCalledWith("ROLLBACK");
    expect(fake.release).toHaveBeenCalledTimes(1);
  });

  it("does not claim success on expired codes, encryption failure or an uncertain commit", async () => {
    fake.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    expect((await POST(request())).status).toBe(409);
    fake.encrypt.mockRejectedValueOnce(new Error("secret diagnostic"));
    const encryption = await POST(request());
    expect(encryption.status).toBe(503);
    expect(await encryption.text()).not.toContain("secret diagnostic");
    fake.query.mockImplementationOnce(async () => ({ rows: [] }))
      .mockImplementationOnce(async () => ({ rows: [{ id: "pair", machine_name: "CAD", cli_version: "1", requested_platform: null }] }))
      .mockImplementationOnce(async () => ({ rows: [{ id: deviceId }] }))
      .mockImplementationOnce(async () => ({ rows: [] }))
      .mockRejectedValueOnce(new Error("COMMIT transport interrupted"));
    const uncertain = await POST(request());
    expect(uncertain.status).toBe(503);
    expect(await uncertain.text()).toContain("Check the connector's pairing status");
    expect(fake.audit).not.toHaveBeenCalled();
  });
});
