import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { IntelHttpError } from "../../../../../lib/intel-auth";

const fake = vi.hoisted(() => ({ session: vi.fn(), scoped: vi.fn(), access: vi.fn(), resolve: vi.fn(), imageGate: vi.fn(), images: vi.fn(), meter: vi.fn(), complete: vi.fn() }));
vi.mock("@vantage/agent", () => ({
  assertRemoteImageAdapter: fake.imageGate, estimateAdapterCostUsd: () => 0.05, getOrgPromptCachingEnabled: async () => false,
  resolveOrgChatAdapterWithProvenance: fake.resolve, validateChatPngImages: fake.images, CHAT_IMAGE_PREFLIGHT_TOKENS: 32768,
}));
vi.mock("@vantage/billing", () => ({ meteredAI: fake.meter }));
vi.mock("../../../../../lib/intel-auth", () => ({
  intelSession: fake.session, withIntelRequest: fake.scoped,
  IntelHttpError: class extends Error { constructor(readonly status: number, message: string) { super(message); } },
}));
vi.mock("../../../../../lib/cad/browser-pilot-access", () => ({ loadBrowserPilotAccess: fake.access }));
vi.mock("../../../../../lib/metered-ai-fail", () => ({ failMeteredAi: () => Response.json({ error: "Model unavailable" }, { status: 503 }) }));

const orgId = "00000000-0000-4000-8000-000000000001";
const input = () => ({
  orgId, requestId: "00000000-0000-4000-8000-000000000002", consent: true,
  task: "Measure this part", step: 0, history: [], evidence: [],
  observation: { id: "current", url: "https://cad.onshape.com/documents", aria: "Documents", screenshotBase64: "png-data", viewport: { width: 1440, height: 900 }, controls: {} },
});
const request = (body = input()) => new Request("https://vantage.example/api/cad/browser-agent/turn", {
  method: "POST", headers: { "content-type": "application/json", origin: "https://vantage.example" }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.resetAllMocks();
  fake.session.mockResolvedValue({ user: { id: "user" } });
  fake.scoped.mockImplementation(async (_org, work) => work({}));
  fake.access.mockResolvedValue({ allowed: true });
  fake.resolve.mockResolvedValue({ adapter: { provider: "anthropic", model: "vision-model", complete: fake.complete }, provenance: { source: "org-key", provider: "anthropic", modelId: "vision-model" } });
  fake.images.mockImplementation((images) => images.map((image: unknown) => ({ image, width: 1440, height: 900, bytes: 100 })));
  fake.complete.mockResolvedValue({ text: '{"kind":"clarification","text":"Which part should I measure?"}', promptTokens: 100, completionTokens: 10, costUsd: 0.01 });
  fake.meter.mockImplementation(async (call) => (await call.invoke()).value);
});

describe("native browser CAD planning route", () => {
  it("checks team/MFA scope and meters a remote image call without executing geometry", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(fake.scoped).toHaveBeenCalledWith(orgId, expect.any(Function));
    expect(fake.resolve.mock.calls[0]?.[1]).not.toHaveProperty("bridgeTransport");
    expect(fake.complete).toHaveBeenCalledWith(expect.objectContaining({ images: [{ mimeType: "image/png", dataBase64: "png-data" }], maxCompletionTokens: 4096, signal: expect.any(AbortSignal) }));
    expect(fake.meter.mock.calls[0]?.[0]).toMatchObject({ estimatedCompletionTokens: 4096, feature: "cad" });
  });

  it("does not call a provider after revoked membership or MFA refusal", async () => {
    fake.scoped.mockRejectedValueOnce(new IntelHttpError(403, "Team sign-in required"));
    expect((await POST(request())).status).toBe(403);
    expect(fake.resolve).not.toHaveBeenCalled();
    expect(fake.complete).not.toHaveBeenCalled();
  });

  it("rejects local, subscription and public provider sources before metering", async () => {
    for (const source of ["local-connector", "subscription-bridge", "public-swarm", "local-fallback"]) {
      fake.resolve.mockResolvedValueOnce({ adapter: {}, provenance: { source } });
      expect((await POST(request())).status).toBe(503);
    }
    expect(fake.meter).not.toHaveBeenCalled();
  });

  it("keeps the metered transaction successful when model output cannot be executed", async () => {
    fake.complete.mockResolvedValueOnce({ text: "invalid model output", promptTokens: 100, completionTokens: 10, costUsd: 0.01 });
    const response = await POST(request());
    expect(response.status).toBe(422);
    await expect(fake.scoped.mock.results[0]!.value).resolves.toHaveProperty("error");
    expect(await response.json()).not.toHaveProperty("decision");
  });

  it("rejects misleading screenshot dimensions and respects budget refusal", async () => {
    const invalid = input(); invalid.observation.viewport.width = 100;
    expect((await POST(request(invalid))).status).toBe(400);
    expect(fake.meter).not.toHaveBeenCalled();
    fake.meter.mockRejectedValueOnce(new Error("Budget exceeded"));
    expect((await POST(request())).status).toBe(503);
    expect(fake.complete).not.toHaveBeenCalled();
  });
});
