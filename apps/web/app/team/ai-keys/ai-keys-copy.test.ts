import { describe, expect, it } from "vitest";
import { FREE_KEY_PROVIDERS } from "../../../lib/ai-keys/free-key-providers";
import {
  ALL_FEATURES_BODY,
  ANY_ENDPOINT_BODY,
  ANY_ENDPOINT_HEADLINE,
  ANY_ENDPOINT_POINTS,
  describeMemberKey,
  ENDPOINT_EXAMPLES,
  MEMBER_KEY_BASE_URL_HINT,
  MEMBER_KEY_BODY,
  memberKeyEndpointHost,
  memberKeyFields,
  PAGE_DESCRIPTION,
  QUALITY_NOTICE_BODY,
  REQUIRED_ENDPOINT_IDS,
} from "./ai-keys-copy";

describe("ENDPOINT_EXAMPLES", () => {
  it("names every endpoint the product promise commits to", () => {
    const ids = new Set(ENDPOINT_EXAMPLES.map((e) => e.id));
    for (const required of REQUIRED_ENDPOINT_IDS) {
      expect(ids.has(required), `missing endpoint example: ${required}`).toBe(true);
    }
  });

  it("has no duplicate ids", () => {
    const ids = ENDPOINT_EXAMPLES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("tells the reader which slot each one goes in — a name alone is not instructions", () => {
    for (const example of ENDPOINT_EXAMPLES) {
      expect(example.name.trim().length, example.id).toBeGreaterThan(0);
      expect(example.howToUse.trim().length, example.id).toBeGreaterThan(0);
    }
  });

  it("covers every provider the free-key panel advertises, so the two panels cannot disagree", () => {
    const covered = ENDPOINT_EXAMPLES.map((e) => e.id);
    for (const free of FREE_KEY_PROVIDERS) {
      // Free-key ids are suffixed variants (e.g. "openrouter-free",
      // "google-ai-studio"); each must map onto an endpoint example.
      const match = covered.some((id) => free.id === id || free.id.startsWith(id) || id.startsWith(free.id));
      expect(match, `free-key provider ${free.id} has no endpoint example`).toBe(true);
    }
  });

  it("offers a catch-all, because the promise is 'anything', not 'this list'", () => {
    expect(ENDPOINT_EXAMPLES.some((e) => e.id === "other")).toBe(true);
  });
});

describe("PAGE_DESCRIPTION", () => {
  it("says 'any', so the examples it lists cannot be read as the allowlist", () => {
    expect(PAGE_DESCRIPTION.toLowerCase()).toContain("any openai-compatible");
  });

  it("names a local runner, which is the case teams assume is excluded", () => {
    const text = PAGE_DESCRIPTION.toLowerCase();
    expect(text.includes("ollama") || text.includes("lm studio")).toBe(true);
  });

  it("repeats the feature-parity promise where it is read first", () => {
    expect(PAGE_DESCRIPTION.toLowerCase()).toMatch(/every ai feature runs through/);
  });
});

describe("page promises", () => {
  it("states feature parity flatly, with no exception clause", () => {
    expect(ALL_FEATURES_BODY).toMatch(/Nothing is reserved for expensive models\./);
    expect(ALL_FEATURES_BODY.toLowerCase()).not.toMatch(/premium only|requires a paid|not available on/);
  });

  it("names the base URL as the mechanism", () => {
    expect(ANY_ENDPOINT_BODY.toLowerCase()).toContain("base url");
  });

  it("names local runners explicitly, so 'anything' is not left abstract", () => {
    const body = ANY_ENDPOINT_BODY.toLowerCase();
    expect(body).toContain("ollama");
    expect(body).toContain("lm studio");
  });

  it("keeps the headline short enough to read as a promise", () => {
    expect(ANY_ENDPOINT_HEADLINE.length).toBeLessThanOrEqual(80);
  });

  it("balances parity with an honest, non-shaming quality note", () => {
    expect(QUALITY_NOTICE_BODY.toLowerCase()).toContain("shorter");
    // Information, not a scolding or an upsell.
    expect(QUALITY_NOTICE_BODY.toLowerCase()).not.toMatch(/upgrade|unsupported|you should|inferior/);
  });

  it("ships the parity claim, the quality note, and the key-handling note together", () => {
    expect(ANY_ENDPOINT_POINTS).toContain(ALL_FEATURES_BODY);
    expect(ANY_ENDPOINT_POINTS).toContain(QUALITY_NOTICE_BODY);
    expect(ANY_ENDPOINT_POINTS.length).toBeGreaterThanOrEqual(3);
  });
});

describe("memberKeyFields", () => {
  it("offers a base URL on the OpenAI slot — the one the route actually stores", () => {
    expect(memberKeyFields("openai")).toEqual({ apiKey: true, baseUrl: true, model: true });
  });

  it("hides the base URL where save_member_key would silently drop it", () => {
    for (const provider of ["anthropic", "google", "openrouter"]) {
      expect(memberKeyFields(provider).baseUrl, provider).toBe(false);
      expect(memberKeyFields(provider).model, provider).toBe(true);
    }
  });

  it("is case- and whitespace-insensitive, matching the server's lower()", () => {
    expect(memberKeyFields("  OpenAI ").baseUrl).toBe(true);
  });

  it("offers nothing beyond the key when no provider is picked yet", () => {
    expect(memberKeyFields("")).toEqual({ apiKey: true, baseUrl: false, model: false });
    expect(memberKeyFields(null)).toEqual({ apiKey: true, baseUrl: false, model: false });
    expect(memberKeyFields(undefined).model).toBe(false);
  });

  it("promises the same endpoint freedom the team form gets", () => {
    const hint = MEMBER_KEY_BASE_URL_HINT.toLowerCase();
    expect(hint).toContain("openai-compatible");
    expect(hint.includes("ollama") || hint.includes("lm studio")).toBe(true);
  });

  it("says plainly that a personal key is private and reversible", () => {
    const body = MEMBER_KEY_BODY.toLowerCase();
    expect(body).toContain("overrides the team key");
    expect(body).toMatch(/remove it/);
  });
});

describe("memberKeyEndpointHost", () => {
  it("keeps the port, which is the whole point of a local runner", () => {
    expect(memberKeyEndpointHost("http://localhost:11434/v1")).toBe("localhost:11434");
  });

  it("accepts a bare host the way a hurried paste supplies it", () => {
    expect(memberKeyEndpointHost("api.groq.com/openai/v1")).toBe("api.groq.com");
  });

  it("returns null rather than echoing an unparseable string back", () => {
    expect(memberKeyEndpointHost("   ")).toBeNull();
    expect(memberKeyEndpointHost(null)).toBeNull();
    expect(memberKeyEndpointHost("http://")).toBeNull();
  });
});

describe("describeMemberKey", () => {
  it("names the endpoint and model when both were stored", () => {
    expect(
      describeMemberKey({ provider: "openai", baseUrl: "http://localhost:11434/v1", model: "llama3.2" }),
    ).toBe("via localhost:11434 · model llama3.2");
  });

  it("never invents an endpoint or a model for an unset field", () => {
    const text = describeMemberKey({ provider: "anthropic", baseUrl: null, model: null });
    expect(text).toBe("via the provider's default endpoint · model from your team's routing");
    expect(text).not.toMatch(/unknown|n\/a/i);
  });
});
