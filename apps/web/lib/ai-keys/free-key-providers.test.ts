import { describe, expect, it } from "vitest";
import {
  FREE_KEY_CAVEAT,
  FREE_KEY_PROVIDERS,
  freeKeySetupSteps,
} from "./free-key-providers";
import { BYOK_PROVIDERS } from "./byok-providers";

describe("free key providers", () => {
  it("lists at least four options so a team always has a fallback", () => {
    expect(FREE_KEY_PROVIDERS.length).toBeGreaterThanOrEqual(4);
  });

  it("maps every entry onto a real BYOK provider slot", () => {
    for (const provider of FREE_KEY_PROVIDERS) {
      expect(BYOK_PROVIDERS).toContain(provider.byokProvider);
    }
  });

  it("gives every OpenAI-compatible entry a base URL and native slots none", () => {
    for (const provider of FREE_KEY_PROVIDERS) {
      if (provider.byokProvider === "openai") {
        expect(provider.baseUrl, `${provider.id} needs a base URL`).toMatch(/^https:\/\//);
      } else {
        expect(provider.baseUrl).toBeNull();
      }
    }
  });

  it("links every entry to a real signup page over https", () => {
    for (const provider of FREE_KEY_PROVIDERS) {
      expect(provider.signupUrl).toMatch(/^https:\/\//);
      expect(provider.note.length).toBeGreaterThan(20);
    }
  });

  it("never claims an unlimited free tier", () => {
    // "none is unlimited" is the caveat itself — only an AFFIRMATIVE claim fails.
    const all = `${FREE_KEY_CAVEAT} ${FREE_KEY_PROVIDERS.map((p) => p.note).join(" ")}`
      .toLowerCase()
      .replace("none is unlimited", "");
    expect(all).not.toContain("unlimited");
    // every note admits a limit
    for (const provider of FREE_KEY_PROVIDERS) {
      expect(provider.note.toLowerCase()).toMatch(/cap|limit/);
    }
  });

  it("keeps the caveat loud and specific", () => {
    expect(FREE_KEY_CAVEAT).toContain("rate-limited");
    expect(FREE_KEY_CAVEAT).toContain("none is unlimited");
  });

  it("has stable ids with no duplicates", () => {
    const ids = FREE_KEY_PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("renders four setup steps mentioning the provider by name", () => {
    const steps = freeKeySetupSteps("Groq");
    expect(steps).toHaveLength(4);
    expect(steps[0]).toContain("Groq");
  });
});
