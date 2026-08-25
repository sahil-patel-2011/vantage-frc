import { describe, expect, it } from "vitest";
import {
  hasProvenance,
  provenanceEndpointLabel,
  provenanceLabel,
  provenanceNotice,
  provenanceNoticeId,
  provenanceOriginHost,
  provenanceSourceLabel,
  UNKNOWN_ENDPOINT_LABEL,
  UNKNOWN_MODEL_LABEL,
} from "./model-provenance-policy";

describe("provenanceOriginHost", () => {
  it("keeps the port, because localhost:11434 is the whole identity of an Ollama box", () => {
    expect(provenanceOriginHost("http://localhost:11434/v1")).toBe("localhost:11434");
  });

  it("drops the default port and any path", () => {
    expect(provenanceOriginHost("https://api.groq.com/openai/v1")).toBe("api.groq.com");
  });

  it("accepts a bare host with no scheme", () => {
    expect(provenanceOriginHost("openrouter.ai")).toBe("openrouter.ai");
  });

  it("returns null rather than echoing an unparseable string back at the user", () => {
    expect(provenanceOriginHost("   ")).toBeNull();
    expect(provenanceOriginHost(null)).toBeNull();
    expect(provenanceOriginHost(undefined)).toBeNull();
    expect(provenanceOriginHost("http://")).toBeNull();
  });
});

describe("provenanceEndpointLabel", () => {
  it("names known providers in their product spelling", () => {
    expect(provenanceEndpointLabel({ provider: "openai" })).toBe("OpenAI");
    expect(provenanceEndpointLabel({ provider: "ollama" })).toBe("Ollama");
    expect(provenanceEndpointLabel({ provider: "lm-studio" })).toBe("LM Studio");
    expect(provenanceEndpointLabel({ provider: "google" })).toBe("Google AI Studio");
  });

  it("passes an unrecognised provider through instead of inventing one", () => {
    expect(provenanceEndpointLabel({ provider: "some-new-host" })).toBe("some-new-host");
  });

  it("prefers the reported origin: an openai key aimed at Groq really is Groq", () => {
    expect(
      provenanceEndpointLabel({ provider: "openai", baseUrlOrigin: "https://api.groq.com" }),
    ).toBe("Groq");
  });

  it("shows a self-hosted origin verbatim", () => {
    expect(
      provenanceEndpointLabel({ provider: "openai", baseUrlOrigin: "http://localhost:1234/v1" }),
    ).toBe("localhost:1234");
  });

  it("falls back to a plain phrase when nothing was reported", () => {
    expect(provenanceEndpointLabel({})).toBe(UNKNOWN_ENDPOINT_LABEL);
  });
});

describe("provenanceLabel", () => {
  it("formats endpoint and model", () => {
    expect(provenanceLabel({ provider: "openrouter", modelId: "deepseek/deepseek-r1" })).toBe(
      "via OpenRouter · deepseek/deepseek-r1",
    );
  });

  it("says the model was not reported rather than guessing a plausible name", () => {
    expect(provenanceLabel({ provider: "anthropic" })).toBe(`via Anthropic · ${UNKNOWN_MODEL_LABEL}`);
  });

  it("handles a fully local run", () => {
    expect(
      provenanceLabel({
        provider: "ollama",
        modelId: "llama3.2:3b",
        baseUrlOrigin: "http://localhost:11434/v1",
      }),
    ).toBe("via localhost:11434 · llama3.2:3b");
  });
});

describe("provenanceSourceLabel", () => {
  it("maps known key sources", () => {
    expect(provenanceSourceLabel("member")).toBe("your personal key");
    expect(provenanceSourceLabel("org")).toBe("your team's key");
    expect(provenanceSourceLabel("hosted")).toBe("Vantage hosted credits");
  });

  it("returns null for unknown or missing sources rather than asserting one", () => {
    expect(provenanceSourceLabel("mystery")).toBeNull();
    expect(provenanceSourceLabel("")).toBeNull();
    expect(provenanceSourceLabel(null)).toBeNull();
  });
});

describe("hasProvenance", () => {
  it("is false when the route reported nothing at all", () => {
    expect(hasProvenance(null)).toBe(false);
    expect(hasProvenance(undefined)).toBe(false);
    expect(hasProvenance({})).toBe(false);
    expect(hasProvenance({ provider: "  ", modelId: null, baseUrlOrigin: "" })).toBe(false);
  });

  it("is true as soon as any one field is real", () => {
    expect(hasProvenance({ modelId: "gpt-4o-mini" })).toBe(true);
    expect(hasProvenance({ baseUrlOrigin: "http://localhost:11434" })).toBe(true);
  });
});

describe("provenanceNotice", () => {
  it("prefers a notice supplied by the caller (degradedNoticeCopy from @vantage/agent)", () => {
    expect(provenanceNotice({ modelId: "gpt-4o-mini" }, "custom copy")).toBe("custom copy");
  });

  it("treats an explicit null as suppression, not as 'use the fallback'", () => {
    expect(provenanceNotice({ modelId: "gpt-4o-mini" }, null)).toBeNull();
  });

  it("treats a blank supplied string as no notice", () => {
    expect(provenanceNotice({ modelId: "gpt-4o-mini" }, "   ")).toBeNull();
  });

  it("falls back to the real classifier when nothing is supplied", () => {
    expect(provenanceNotice({ modelId: "llama3.2:3b" })).toContain("llama3.2:3b");
    expect(provenanceNotice({ modelId: "claude-opus-4" })).toBeNull();
  });

  it("sets expectations for a hosted mini model without an error tone", () => {
    const notice = provenanceNotice({ modelId: "gpt-4o-mini" });
    expect(notice).toContain("gpt-4o-mini");
    expect(notice?.toLowerCase()).not.toMatch(/error|unsupported|not supported|failed/);
  });
});

describe("provenanceNoticeId", () => {
  it("is stable across runs of the same model on the same endpoint", () => {
    const meta = { provider: "ollama", modelId: "llama3.2:3b" };
    expect(provenanceNoticeId(meta)).toBe(provenanceNoticeId({ ...meta }));
  });

  it("changes when the model changes, so a new small model is announced once", () => {
    expect(provenanceNoticeId({ provider: "ollama", modelId: "llama3.2:3b" })).not.toBe(
      provenanceNoticeId({ provider: "ollama", modelId: "phi3:mini" }),
    );
  });

  it("changes when the endpoint changes", () => {
    expect(provenanceNoticeId({ provider: "ollama", modelId: "x" })).not.toBe(
      provenanceNoticeId({ provider: "groq", modelId: "x" }),
    );
  });
});
