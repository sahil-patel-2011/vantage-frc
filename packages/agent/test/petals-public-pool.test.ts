import { describe, expect, it, vi } from "vitest";
import {
  PETALS_DEFAULT_GENERATE_URL,
  PETALS_DEFAULT_MODEL,
  PetalsPublicPoolAdapter,
  buildPetalsPrompt,
  isPetalsPublicPoolEnabled,
  petalsGenerateUrl,
  sanitizePetalsContext,
  tryCreatePetalsPublicAdapter,
} from "../src/petals-public-pool";

describe("Petals public pool config", () => {
  it("is on by default and off only for explicit disable flags", () => {
    expect(isPetalsPublicPoolEnabled({})).toBe(true);
    expect(isPetalsPublicPoolEnabled({ PETALS_PUBLIC_POOL: "1" })).toBe(true);
    expect(isPetalsPublicPoolEnabled({ PETALS_PUBLIC_POOL: "0" })).toBe(false);
    expect(isPetalsPublicPoolEnabled({ PETALS_PUBLIC_POOL: "false" })).toBe(false);
    expect(isPetalsPublicPoolEnabled({ PETALS_PUBLIC_POOL: "off" })).toBe(false);
  });

  it("appends the generate path when only an origin is configured", () => {
    expect(petalsGenerateUrl({})).toBe(PETALS_DEFAULT_GENERATE_URL);
    expect(petalsGenerateUrl({ PETALS_API_URL: "https://chat.petals.dev" })).toBe(
      "https://chat.petals.dev/api/v1/generate",
    );
    expect(
      petalsGenerateUrl({ PETALS_API_URL: "https://example.test/api/v1/generate/" }),
    ).toBe("https://example.test/api/v1/generate");
  });

  it("does not build an adapter when the pool is disabled", () => {
    expect(tryCreatePetalsPublicAdapter({ env: { PETALS_PUBLIC_POOL: "0" } })).toBeNull();
    expect(tryCreatePetalsPublicAdapter({ env: {} })?.model).toBe(PETALS_DEFAULT_MODEL);
  });
});

describe("Petals prompt hygiene", () => {
  it("drops private memory and redacts finance-looking digits", () => {
    const sanitized = sanitizePetalsContext([
      { type: "private_memory", id: "m1", content: "secret notebook", importance: 90 },
      { type: "team_memory", id: "t1", content: "routing 021000021", importance: 40 },
      { type: "module_fact", id: "f1", content: "Match 3 high scored 12", importance: 50 },
    ]);
    expect(sanitized.map((item) => item.id)).toEqual(["t1", "f1"]);
    expect(sanitized[0]?.content).toMatch(/\[REDACTED\]/);
    expect(sanitized[1]?.content).toContain("Match 3");
  });

  it("labels the answer path as the public swarm", () => {
    const prompt = buildPetalsPrompt({
      capability: "chat",
      message: "What is our EPA?",
      context: [],
    });
    expect(prompt).toMatch(/public Petals volunteer swarm/i);
    expect(prompt).toContain("User: What is our EPA?");
    expect(prompt).toContain("Assistant:");
  });
});

describe("PetalsPublicPoolAdapter", () => {
  it("posts form fields to the generate URL and records zero cost", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? init.body : String(init?.body ?? "");
      expect(body).toContain("model=petals-team%2FStableBeluga2");
      expect(body).toContain("max_new_tokens=256");
      return new Response(JSON.stringify({ ok: true, outputs: " Grounded from context." }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const adapter = new PetalsPublicPoolAdapter({
      generateUrl: PETALS_DEFAULT_GENERATE_URL,
      model: PETALS_DEFAULT_MODEL,
      capability: "chat",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 5_000,
    });
    const result = await adapter.complete({
      message: "Hello",
      context: [],
    });
    expect(adapter.provider).toBe("petals");
    expect(result.text).toBe("Grounded from context.");
    expect(result.costUsd).toBe(0);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("treats a swarm ok:false as capacity, not a fake answer", async () => {
    const adapter = new PetalsPublicPoolAdapter({
      generateUrl: PETALS_DEFAULT_GENERATE_URL,
      model: PETALS_DEFAULT_MODEL,
      capability: "chat",
      fetchImpl: (async () =>
        new Response(JSON.stringify({ ok: false, traceback: "no peers" }), {
          status: 200,
        })) as unknown as typeof fetch,
      timeoutMs: 5_000,
    });
    await expect(adapter.complete({ message: "Hi", context: [] })).rejects.toMatchObject({
      name: "ProviderRateLimitError",
    });
  });
});
