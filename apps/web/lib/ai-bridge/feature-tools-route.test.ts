import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  identify: vi.fn(), invoke: vi.fn(), list: vi.fn(), allow: vi.fn(),
}));
vi.mock("./feature-tools", () => ({
  personalDeviceIdentity: mocks.identify, invokePersonalTool: mocks.invoke, listPersonalTools: mocks.list,
  PersonalToolError: class extends Error { constructor(message: string, readonly status: number) { super(message); } },
}));
vi.mock("../rate-limit", () => ({ createRateLimiter: () => ({ allow: mocks.allow }) }));
const { GET, POST } = await import("../../app/api/ai-bridge/device/tools/route");
const { PersonalToolError } = await import("./feature-tools");
const identity = { deviceId: "device", orgId: "own-org", userId: "own-user" };
const token = "a".repeat(32);
const request = (body: unknown, auth = `Bearer ${token}`) => new Request("http://localhost/api/ai-bridge/device/tools", { method: "POST", headers: { authorization: auth }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks(); mocks.identify.mockResolvedValue(identity); mocks.allow.mockResolvedValue(true);
  mocks.invoke.mockResolvedValue({ status: "proposed", requiresConfirmation: true }); mocks.list.mockResolvedValue([]);
});
describe("personal device tool API", () => {
  it("derives the actor from the token and returns a proposal without confirming it", async () => {
    const response = await POST(request({ name: "vantage_cad_create_brief", input: { request: "Repair intake" } }));
    expect(response.status).toBe(200);
    expect(mocks.identify).toHaveBeenCalledWith(token);
    expect(mocks.invoke).toHaveBeenCalledWith(identity, "vantage_cad_create_brief", { request: "Repair intake" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("rejects caller-supplied identity, invalid JSON and oversized requests", async () => {
    expect((await POST(request({ name: "vantage_cad_briefs", input: {}, orgId: "other-team" }))).status).toBe(400);
    expect((await POST(request([]))).status).toBe(400);
    expect((await POST(request({ name: "vantage_cad_briefs", input: "x".repeat(20_000) }))).status).toBe(413);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("rejects missing/revoked credentials and rate-limited callers", async () => {
    expect((await POST(request({}, ""))).status).toBe(401);
    mocks.identify.mockRejectedValueOnce(new PersonalToolError("Revoked", 401));
    expect((await POST(request({}))).status).toBe(401);
    mocks.allow.mockResolvedValueOnce(false);
    expect((await GET(new Request("http://localhost/api/ai-bridge/device/tools", { headers: { authorization: `Bearer ${token}` } }))).status).toBe(429);
    expect(mocks.invoke).not.toHaveBeenCalled(); expect(mocks.list).not.toHaveBeenCalled();
  });
});
