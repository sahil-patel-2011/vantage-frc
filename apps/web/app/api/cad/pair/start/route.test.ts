import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
const fake = vi.hoisted(() => ({ pool: vi.fn(), query: vi.fn() }));
vi.mock("@vantage/db/cad-relay", () => ({ getCadRelayPool: fake.pool }));
const body = { machineName: "CAD laptop", cliVersion: "0.1.1" };
const request = (data: unknown = body, origin?: string) => new Request("https://vantage.example/api/cad/pair/start", {
  method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(data),
});
beforeEach(() => {
  vi.resetAllMocks();
  fake.pool.mockReturnValue({ query: fake.query });
  fake.query.mockResolvedValue({ rows: [{ count: "0" }] });
});

describe("public CLI pairing start", () => {
  it("supports legacy CLI without Origin/platform and returns private, bounded pairing data", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const result = await response.json();
    expect(result).toMatchObject({ userCode: expect.stringMatching(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/), pollToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), expiresIn: 600 });
    expect(result.verificationUri).not.toContain(result.pollToken);
    expect(fake.query.mock.calls[1]![1][4]).toBeNull();
  });
  it("preserves explicitly requested platforms in storage and approval links", async () => {
    for (const platform of ["onshape", "fusion360"]) {
      const response = await POST(request({ ...body, platform }, "https://vantage.example"));
      expect((await response.json()).verificationUri).toContain(`platform=${platform}`);
      expect(fake.query.mock.calls.at(-1)![1][4]).toBe(platform);
    }
  });
  it("rejects cross-site, oversized and invalid platform requests before creating codes", async () => {
    expect((await POST(request(body, "https://other.example"))).status).toBe(403);
    for (const data of [{ ...body, platform: "arbitrary" }, { ...body, machineName: 5 }, { ...body, cliVersion: "x".repeat(101) }, { ...body, unexpected: true }]) {
      expect((await POST(request(data))).status).toBe(400);
    }
    expect((await POST(request({ ...body, machineName: "x".repeat(3000) }))).status).toBe(413);
    expect(fake.pool).not.toHaveBeenCalled();
  });
  it("keeps the existing attempt limit and distinguishes missing deployment setup", async () => {
    fake.query.mockResolvedValueOnce({ rows: [{ count: "8" }] });
    expect((await POST(request())).status).toBe(429);
    expect(fake.query).toHaveBeenCalledTimes(1);
    fake.pool.mockImplementationOnce(() => { throw new Error("DATABASE_CAD_RELAY_URL is required"); });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ missingEnv: ["DATABASE_CAD_RELAY_URL"] });
  });
});
