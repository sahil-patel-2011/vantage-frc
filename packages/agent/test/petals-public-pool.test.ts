import { describe, expect, it, vi } from "vitest";
import {
  PETALS_DEFAULT_GENERATE_URL,
  PETALS_DEFAULT_MODEL,
  PetalsPublicPoolAdapter,
  buildPetalsPrompt,
  isPetalsPublicPoolEnabled,
  petalsGenerateUrl,
  sanitizePetalsContext,
  petalsFailureMessage,
  tryCreatePetalsPublicAdapter,
} from "../src/petals-public-pool";

describe("Petals public pool config", () => {
  it("is off until a team turns it on", () => {
    // Petals' own docs say not to send confidential data to the public swarm:
    // peers can read the input, read the output, and change the output. A
    // missing API key must not be what opts a team into that.
    expect(isPetalsPublicPoolEnabled({})).toBe(false);
    expect(isPetalsPublicPoolEnabled({ PETALS_PUBLIC_POOL: "" })).toBe(false);
    expect(isPetalsPublicPoolEnabled({ PETALS_PUBLIC_POOL: "0" })).toBe(false);
    expect(isPetalsPublicPoolEnabled({ PETALS_PUBLIC_POOL: "false" })).toBe(false);
    expect(isPetalsPublicPoolEnabled({ PETALS_PUBLIC_POOL: "off" })).toBe(false);
  });

  it("turns on for explicit enable flags only", () => {
    expect(isPetalsPublicPoolEnabled({ PETALS_PUBLIC_POOL: "1" })).toBe(true);
    expect(isPetalsPublicPoolEnabled({ PETALS_PUBLIC_POOL: "true" })).toBe(true);
    expect(isPetalsPublicPoolEnabled({ PETALS_PUBLIC_POOL: "on" })).toBe(true);
    expect(isPetalsPublicPoolEnabled({ PETALS_PUBLIC_POOL: "YES" })).toBe(true);
    // Not a typo-tolerant flag: anything unrecognised stays off.
    expect(isPetalsPublicPoolEnabled({ PETALS_PUBLIC_POOL: "maybe" })).toBe(false);
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

  it("builds no adapter unless the pool was turned on", () => {
    expect(tryCreatePetalsPublicAdapter({ env: { PETALS_PUBLIC_POOL: "0" } })).toBeNull();
    // The case that matters: nothing configured at all. A team that never
    // opted in must not get an adapter that ships prompts to strangers.
    expect(tryCreatePetalsPublicAdapter({ env: {} })).toBeNull();
  });

  it("builds the adapter once the pool is turned on", () => {
    expect(tryCreatePetalsPublicAdapter({ env: { PETALS_PUBLIC_POOL: "1" } })?.model).toBe(
      PETALS_DEFAULT_MODEL,
    );
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

describe("what the swarm's refusals actually mean", () => {
  it("says an empty swarm is empty, not busy", () => {
    // Measured against chat.petals.dev on 2026-09-19: this is the live case.
    const traceback =
      "petals.client.routing.sequence_manager.MissingBlocksError: No servers holding blocks [0, 1, 2] are online.";
    const message = petalsFailureMessage(traceback, "petals-team/StableBeluga2");
    expect(message).toContain("No volunteer is hosting");
    expect(message).toContain("waiting will not help");
    // And points at something that does work.
    expect(message).toMatch(/Ollama|LM Studio|provider key/);
  });

  it("distinguishes a model the swarm does not serve at all", () => {
    const message = petalsFailureMessage("nKeyError: 'meta-llama/Meta-Llama-3.1-405B-Instruct'", "x");
    expect(message).toContain("does not serve");
    expect(message).toContain("PETALS_MODEL");
  });

  it("stays useful when the traceback is missing or unrecognised", () => {
    expect(petalsFailureMessage(undefined, "m")).toContain("volunteer-run");
    expect(petalsFailureMessage("some other python error", "m")).toContain("volunteer-run");
  });

  it("never leaks a Python traceback to a student", () => {
    const traceback = 'File "/home/user/chat.petals.dev/http_api.py", line 37, in http_api_generate';
    const message = petalsFailureMessage(traceback, "m");
    expect(message).not.toContain("http_api.py");
    expect(message).not.toContain("Traceback");
  });
});
