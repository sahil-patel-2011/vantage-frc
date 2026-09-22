import { describe, expect, it, vi } from "vitest";
import {
  GraphClient,
  GraphError,
  MICROSOFT_SETUP_MESSAGE,
  backoffDelayMs,
  buildMicrosoftAuthorizeUrl,
  describeGraphError,
  fetchWithRetry,
  getMicrosoftConfig,
  microsoftSetupStatus,
  parseRetryAfter,
  pkceChallenge,
  refreshMicrosoftTokens,
} from "./graph";

function res(status: number, body: unknown = {}, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** fetch mock that plays back responses in order and records calls. */
function scripted(...responses: Array<Response | (() => Response)>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("no more scripted responses");
    return typeof next === "function" ? next() : next;
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const ENV = {
  MICROSOFT_CLIENT_ID: "client-id",
  MICROSOFT_CLIENT_SECRET: "client-secret",
  BETTER_AUTH_URL: "https://vantage.example",
} as unknown as NodeJS.ProcessEnv;

describe("setup state", () => {
  it("reports setup-required with the docs pointer when the app registration is missing", () => {
    const status = microsoftSetupStatus({} as NodeJS.ProcessEnv);
    expect(status.configured).toBe(false);
    expect(status.missingEnv).toEqual(["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"]);
    expect(status.message).toBe(MICROSOFT_SETUP_MESSAGE);
    expect(status.message).toContain("docs/MICROSOFT_EXCEL.md");
    expect(getMicrosoftConfig({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it("defaults the tenant to common and derives the callback from BETTER_AUTH_URL", () => {
    const config = getMicrosoftConfig(ENV)!;
    expect(config.tenant).toBe("common");
    expect(config.redirectUri).toBe("https://vantage.example/api/integrations/microsoft/callback");
    expect(config.scopes).toEqual(["offline_access", "Files.ReadWrite", "User.Read"]);
    expect(getMicrosoftConfig({ ...ENV, MICROSOFT_TENANT: "consumers" })!.tenant).toBe("consumers");
    expect(getMicrosoftConfig({ ...ENV, MICROSOFT_TENANT: "bad/tenant?x" })!.tenant).toBe("common");
  });

  it("builds the v2 authorize URL with PKCE S256", () => {
    const config = getMicrosoftConfig(ENV)!;
    const url = new URL(buildMicrosoftAuthorizeUrl(config, "signed.state", "verifier-value"));
    expect(url.origin + url.pathname).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("response_mode")).toBe("query");
    expect(url.searchParams.get("scope")).toBe("offline_access Files.ReadWrite User.Read");
    expect(url.searchParams.get("state")).toBe("signed.state");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(pkceChallenge("verifier-value"));
    expect(url.searchParams.get("client_secret")).toBeNull();
  });
});

describe("Retry-After and backoff", () => {
  it("parses delta-seconds and HTTP-dates", () => {
    expect(parseRetryAfter("10")).toBe(10_000);
    expect(parseRetryAfter("1.5")).toBe(1_500);
    const now = Date.parse("2026-09-22T12:00:00Z");
    expect(parseRetryAfter("Tue, 22 Sep 2026 12:00:07 GMT", now)).toBe(7_000);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("soon")).toBeNull();
  });

  it("grows exponentially, is capped, and jitters", () => {
    expect(backoffDelayMs(1, 500, 8_000, () => 1)).toBe(500);
    expect(backoffDelayMs(3, 500, 8_000, () => 1)).toBe(2_000);
    expect(backoffDelayMs(10, 500, 8_000, () => 1)).toBe(8_000);
    expect(backoffDelayMs(3, 500, 8_000, () => 0.25)).toBe(500);
    expect(backoffDelayMs(3, 500, 8_000, () => 0)).toBe(0);
  });
});

describe("fetchWithRetry", () => {
  it("honours Retry-After on 429 and then succeeds", async () => {
    const sleep = vi.fn(async () => {});
    const { impl, calls } = scripted(res(429, {}, { "retry-after": "2" }), res(200, { ok: true }));
    const response = await fetchWithRetry("https://graph/x", { method: "GET" }, { fetchImpl: impl, sleep });
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(sleep).toHaveBeenCalledWith(2_000);
  });

  it("uses jittered exponential backoff for 503/504 without Retry-After", async () => {
    const sleep = vi.fn(async () => {});
    const { impl } = scripted(res(503), res(504), res(200));
    await fetchWithRetry("https://graph/x", {}, { fetchImpl: impl, sleep, random: () => 0.5, baseDelayMs: 400 });
    expect(sleep.mock.calls.map((call) => (call as unknown[])[0])).toEqual([200, 400]);
  });

  it("does not retry other errors", async () => {
    const sleep = vi.fn(async () => {});
    for (const status of [400, 401, 403, 404, 409, 500, 502]) {
      const { impl, calls } = scripted(res(status));
      const response = await fetchWithRetry("https://graph/x", {}, { fetchImpl: impl, sleep });
      expect(response.status).toBe(status);
      expect(calls).toHaveLength(1);
    }
    expect(sleep).not.toHaveBeenCalled();
  });

  it("gives up after maxAttempts and returns the last response", async () => {
    const sleep = vi.fn(async () => {});
    const { impl, calls } = scripted(res(429), res(429), res(429));
    const response = await fetchWithRetry("https://graph/x", {}, { fetchImpl: impl, sleep, maxAttempts: 3, random: () => 0 });
    expect(response.status).toBe(429);
    expect(calls).toHaveLength(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("does not wait out a Retry-After longer than the cap", async () => {
    const sleep = vi.fn(async () => {});
    const { impl, calls } = scripted(res(429, {}, { "retry-after": "600" }));
    const response = await fetchWithRetry("https://graph/x", {}, { fetchImpl: impl, sleep, maxRetryAfterMs: 30_000 });
    expect(response.status).toBe(429);
    expect(calls).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("times out a hung request as `unavailable` without retrying it", async () => {
    let calls = 0;
    const hang = ((_url: string, init?: RequestInit) => {
      calls += 1;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    }) as unknown as typeof fetch;
    await expect(fetchWithRetry("https://graph/x", {}, { fetchImpl: hang, timeoutMs: 10 })).rejects.toMatchObject({
      kind: "unavailable",
      code: "timeout",
    });
    expect(calls).toBe(1);
  });
});

describe("GraphClient errors", () => {
  const cases: Array<[number, GraphError["kind"]]> = [
    [401, "auth_expired"],
    [403, "forbidden"],
    [404, "not_found"],
    [409, "conflict"],
    [500, "unavailable"],
    [400, "bad_request"],
  ];
  for (const [status, kind] of cases) {
    it(`maps HTTP ${status} to ${kind}`, async () => {
      const { impl } = scripted(res(status, { error: { code: "SomeCode", message: "Nope" } }));
      const graph = new GraphClient("secret-access-token", { fetchImpl: impl });
      await expect(graph.request("GET", "/me")).rejects.toMatchObject({ kind, status, code: "SomeCode" });
    });
  }

  it("maps a still-throttled 429 to `throttled` with its Retry-After", async () => {
    const { impl } = scripted(res(429, { error: { code: "TooManyRequests" } }, { "retry-after": "120" }));
    const graph = new GraphClient("t", { fetchImpl: impl, maxRetryAfterMs: 1_000 });
    await expect(graph.request("GET", "/me")).rejects.toMatchObject({ kind: "throttled", retryAfterMs: 120_000 });
  });

  it("sends the bearer token and the workbook session header, and never puts the token in an error", async () => {
    const { impl, calls } = scripted(res(500, { error: { code: "generalException", message: "boom" } }));
    const graph = new GraphClient("secret-access-token", { fetchImpl: impl });
    graph.sessionId = "session-1";
    const error = await graph.request("POST", "/x", { body: { a: 1 } }).catch((e: unknown) => e as GraphError);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer secret-access-token");
    expect(headers["workbook-session-id"]).toBe("session-1");
    expect(JSON.stringify({ message: error.message, code: error.code })).not.toContain("secret-access-token");
    expect(describeGraphError(error)).not.toContain("secret-access-token");
  });
});

describe("token endpoint", () => {
  it("treats invalid_grant as auth_expired (reconnect)", async () => {
    const { impl } = scripted(
      res(400, { error: "invalid_grant", error_description: "AADSTS70000: expired.\r\nTrace ID: x", error_codes: [70000] }),
    );
    await expect(refreshMicrosoftTokens(getMicrosoftConfig(ENV)!, "old-refresh", { fetchImpl: impl })).rejects.toMatchObject({
      kind: "auth_expired",
      code: "invalid_grant",
      message: "AADSTS70000: expired.",
    });
  });

  it("posts a form-encoded refresh grant and keeps the old refresh token when none is rotated in", async () => {
    const { impl, calls } = scripted(res(200, { access_token: "new-access", expires_in: 3599 }));
    const tokens = await refreshMicrosoftTokens(getMicrosoftConfig(ENV)!, "old-refresh", { fetchImpl: impl });
    expect(tokens).toMatchObject({ accessToken: "new-access", refreshToken: "old-refresh", expiresInSeconds: 3599 });
    expect(calls[0]!.url).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/token");
    const body = new URLSearchParams(String(calls[0]!.init.body));
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("old-refresh");
    expect(body.get("client_secret")).toBe("client-secret");
  });

  it("returns the rotated refresh token when Microsoft issues one", async () => {
    const { impl } = scripted(res(200, { access_token: "a", refresh_token: "rotated", expires_in: 3599 }));
    const tokens = await refreshMicrosoftTokens(getMicrosoftConfig(ENV)!, "old", { fetchImpl: impl });
    expect(tokens.refreshToken).toBe("rotated");
  });
});
