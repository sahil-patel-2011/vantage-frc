import { describe, expect, it } from "vitest";
import {
  attachWorkspaceToChatBody,
  authorizePiLayer,
  catalogFallback,
  clampChatCompletionBody,
  healthPayload,
  joinUpstream,
  PI_LAYER_DEFAULT_UPSTREAM,
  PI_LAYER_FAILOVER_STATUSES,
  piLayerErrorBody,
  readPiLayerConfig,
  redactSecrets,
  routePiLayer,
} from "../src/pi-layer";

describe("readPiLayerConfig", () => {
  it("binds loopback and points at the on-box Freebuff Coder UI", () => {
    const config = readPiLayerConfig({
      FREE_RELAY_API_KEY: "vr_test",
      FREE_RELAY_MODEL: "glm/glm-5.3-flash",
    });
    expect(config.bindHost).toBe("127.0.0.1");
    expect(config.port).toBe(8080);
    expect(config.upstreamBaseUrl).toBe(PI_LAYER_DEFAULT_UPSTREAM);
    expect(config.model).toBe("glm/glm-5.3-flash");
    expect(config.maxConcurrent).toBe(16);
  });

  it("does not invent a key when none was set", () => {
    expect(readPiLayerConfig({}).apiKey).toBe("");
  });
});

describe("routePiLayer", () => {
  it("names the three routes Vantage actually hits", () => {
    expect(routePiLayer("GET", "/healthz")).toBe("health");
    expect(routePiLayer("GET", "/v1/stats")).toBe("stats");
    expect(routePiLayer("GET", "/v1/models")).toBe("models");
    expect(routePiLayer("POST", "/v1/chat/completions")).toBe("chat");
    expect(routePiLayer("POST", "/chat/completions")).toBe("chat");
  });

  it("does not pretend an unknown path exists", () => {
    expect(routePiLayer("GET", "/admin")).toBe("unknown");
    expect(routePiLayer("DELETE", "/v1/models")).toBe("unknown");
  });
});

describe("authorizePiLayer", () => {
  it("accepts the configured bearer key and nothing else", () => {
    expect(authorizePiLayer("Bearer vr_secret", "vr_secret")).toBe(true);
    expect(authorizePiLayer("Bearer other", "vr_secret")).toBe(false);
    expect(authorizePiLayer(undefined, "vr_secret")).toBe(false);
  });

  it("refuses to start an open pass-through when the expected key is empty", () => {
    expect(authorizePiLayer("Bearer anything", "")).toBe(false);
    expect(authorizePiLayer(undefined, "")).toBe(false);
  });
});

describe("joinUpstream", () => {
  it("keeps /v1 on the wire even if the client omitted it", () => {
    expect(joinUpstream("http://127.0.0.1:18080", "/chat/completions")).toBe(
      "http://127.0.0.1:18080/v1/chat/completions",
    );
    expect(joinUpstream("http://127.0.0.1:18080/", "/v1/models")).toBe(
      "http://127.0.0.1:18080/v1/models",
    );
  });
});

describe("error shape", () => {
  it("marks spent-pool and auth failures as failover, not bad requests", () => {
    expect(PI_LAYER_FAILOVER_STATUSES.has(403)).toBe(true);
    expect(PI_LAYER_FAILOVER_STATUSES.has(429)).toBe(true);
    expect(PI_LAYER_FAILOVER_STATUSES.has(400)).toBe(false);
    expect(piLayerErrorBody(403, "cli required").error.code).toBe("relay_upstream");
    expect(piLayerErrorBody(400, "missing model").error.code).toBe("bad_request");
  });
});

describe("health and catalog", () => {
  it("says Connect is not the inbound path", () => {
    const config = readPiLayerConfig({ FREE_RELAY_API_KEY: "vr_test" });
    const health = healthPayload(config, false);
    expect(String(health.note)).toMatch(/tunnel/i);
    expect(health.bind).toBe("127.0.0.1:8080");
    expect(health.upstreamOk).toBe(false);
  });

  it("lists picker models with DeepSeek V4 Flash first when the proxy catalog is down", () => {
    const config = readPiLayerConfig({
      FREE_RELAY_API_KEY: "vr_test",
      FREE_RELAY_MODEL: "deepseek/deepseek-v4-flash",
    });
    expect(config.model).toBe("deepseek/deepseek-v4-flash");
    expect(catalogFallback(config).data).toEqual([
      { id: "deepseek/deepseek-v4-flash", object: "model", owned_by: "freebuff" },
      { id: "glm/glm-5.3-flash", object: "model", owned_by: "freebuff" },
      { id: "mimo/mimo-2.5", object: "model", owned_by: "freebuff" },
    ]);
  });
});

describe("clampChatCompletionBody", () => {
  it("forwards DeepSeek V4 Flash when the picker asked for it", () => {
    const next = JSON.parse(
      clampChatCompletionBody(
        JSON.stringify({ model: "deepseek/deepseek-v4-flash", messages: [] }),
        "mimo/mimo-2.5",
      ),
    ) as { model: string };
    expect(next.model).toBe("deepseek/deepseek-v4-flash");
  });

  it("clamps an unknown slug to DeepSeek V4 Flash", () => {
    const next = JSON.parse(
      clampChatCompletionBody(JSON.stringify({ model: "gpt-4.1-mini", messages: [] }), "mimo/mimo-2.5"),
    ) as { model: string };
    expect(next.model).toBe("deepseek/deepseek-v4-flash");
  });

  it("keeps MiMo when that is the requested unmetered slug", () => {
    const next = JSON.parse(
      clampChatCompletionBody(JSON.stringify({ model: "mimo-2.5" }), "glm/glm-5.3-flash"),
    ) as { model: string };
    expect(next.model).toBe("mimo/mimo-2.5");
  });
});

describe("attachWorkspaceToChatBody", () => {
  it("pins the completion to one org folder under the shared root", () => {
    const next = JSON.parse(
      attachWorkspaceToChatBody(JSON.stringify({ model: "glm/glm-5.3-flash", messages: [{ role: "user", content: "hi" }] }), {
        folder: "/home/vantage/vantage-freebuff/orgs/org-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        note: "Coding folder for organization aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa only: /home/vantage/vantage-freebuff/orgs/org-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa. Do not read or write any sibling org-* folder.",
      }),
    ) as { workspace: string; messages: Array<{ role: string; content: string }> };
    expect(next.workspace).toContain("org-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(next.messages[0]?.role).toBe("system");
    expect(next.messages[0]?.content).toMatch(/sibling org-\*/);
    expect(next.messages[1]?.content).toBe("hi");
  });
});

describe("redactSecrets", () => {
  it("never leaves a bearer or JWT on a log line", () => {
    expect(redactSecrets("Authorization: Bearer vr_abc.def")).not.toContain("vr_abc");
    expect(redactSecrets("token eyJhbGciOiJIUzI1NiJ9.aa.bb")).not.toContain("eyJ");
  });
});
