import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCallBudget } from "../src/call-budget";
import {
  classifyOnshapeResponse,
  createOnshapeSessionHttp,
  onshapeApiUrl,
  onshapeAuthStatus,
  OnshapeAuthUnavailableError,
  OnshapeSessionExpiredError,
  probeOnshapeIdentity,
  resolveOnshapeAuth,
} from "../src/onshape-session";
import {
  clearOnshapeBrowserSession,
  cookieDomainMatches,
  cookieHeaderFor,
  cookiePathMatches,
  isOnshapeSessionExpired,
  isReplayableSessionHeader,
  loadOnshapeBrowserSession,
  normalizeOnshapeCookies,
  onshapeSessionExpiresAt,
  onshapeSessionStatus,
  saveOnshapeBrowserSession,
  type OnshapeBrowserSession,
} from "../src/onshape-session-store";

const NOW = Date.UTC(2026, 7, 24, 12, 0, 0);
const HOUR = 3_600_000;

function sessionFixture(overrides: Partial<OnshapeBrowserSession> = {}): OnshapeBrowserSession {
  return {
    version: 1,
    baseUrl: "https://cad.onshape.com",
    cookies: [
      {
        name: "onshape_auth",
        value: "cookie-value",
        domain: ".onshape.com",
        path: "/",
        expires: (NOW + 24 * HOUR) / 1000,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
      {
        name: "ui_pref",
        value: "dark",
        domain: "cad.onshape.com",
        path: "/documents",
        expires: -1,
        httpOnly: false,
        secure: false,
      },
    ],
    headers: { "x-xsrf-token": "token" },
    capturedAt: new Date(NOW).toISOString(),
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200, url = "https://cad.onshape.com/api/v6/users/current"): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    url,
    redirected: false,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
  } as unknown as Response;
}

describe("cookie matching", () => {
  it("follows RFC 6265 domain and path rules", () => {
    expect(cookieDomainMatches(".onshape.com", "cad.onshape.com")).toBe(true);
    expect(cookieDomainMatches("cad.onshape.com", "cad.onshape.com")).toBe(true);
    expect(cookieDomainMatches("cad.onshape.com", "evil-cad.onshape.com")).toBe(false);
    expect(cookieDomainMatches(".onshape.com", "onshape.com.evil.test")).toBe(false);

    expect(cookiePathMatches("/", "/api/v6/users/current")).toBe(true);
    expect(cookiePathMatches("/documents", "/documents/abc")).toBe(true);
    expect(cookiePathMatches("/documents", "/documentsX")).toBe(false);
  });

  it("sends only cookies that match host, path, scheme, and expiry", () => {
    const header = cookieHeaderFor("https://cad.onshape.com/api/v6/users/current", sessionFixture(), NOW);
    // ui_pref is scoped to /documents, so it must not travel to /api.
    expect(header).toBe("onshape_auth=cookie-value");

    const onDocuments = cookieHeaderFor("https://cad.onshape.com/documents/x", sessionFixture(), NOW);
    expect(onDocuments).toContain("ui_pref=dark");

    // A secure cookie never goes out over http.
    expect(cookieHeaderFor("http://cad.onshape.com/api/v6/users/current", sessionFixture(), NOW)).toBe("");

    // Nothing after the stored expiry.
    expect(cookieHeaderFor("https://cad.onshape.com/api/v6/users/current", sessionFixture(), NOW + 48 * HOUR)).toBe("");
  });

  it("drops cookies for hosts that are not Onshape", () => {
    const cookies = normalizeOnshapeCookies([
      { name: "a", value: "1", domain: ".onshape.com", path: "/" },
      { name: "b", value: "2", domain: "accounts.google.com", path: "/" },
      { name: "", value: "3", domain: ".onshape.com", path: "/" },
    ]);
    expect(cookies.map((cookie) => cookie.name)).toEqual(["a"]);
    expect(cookies[0]?.expires).toBe(-1);
  });

  it("replays only CSRF-style headers, never cookie or authorization", () => {
    expect(isReplayableSessionHeader("X-XSRF-TOKEN")).toBe(true);
    expect(isReplayableSessionHeader("x-csrf-token")).toBe(true);
    expect(isReplayableSessionHeader("cookie")).toBe(false);
    expect(isReplayableSessionHeader("authorization")).toBe(false);
    expect(isReplayableSessionHeader("user-agent")).toBe(false);
  });
});

describe("session expiry", () => {
  it("reads expiry from persistent httpOnly cookies and reports it honestly when unknown", () => {
    expect(onshapeSessionExpiresAt(sessionFixture())).toBe(NOW + 24 * HOUR);
    expect(isOnshapeSessionExpired(sessionFixture(), NOW)).toBe(false);
    expect(isOnshapeSessionExpired(sessionFixture(), NOW + 25 * HOUR)).toBe(true);

    const browserSessionOnly = sessionFixture({
      cookies: [
        { name: "onshape_auth", value: "v", domain: ".onshape.com", path: "/", expires: -1, httpOnly: true, secure: true },
      ],
    });
    expect(onshapeSessionExpiresAt(browserSessionOnly)).toBeNull();
    expect(isOnshapeSessionExpired(browserSessionOnly, NOW + 10 * 365 * 24 * HOUR)).toBe(false);
    expect(onshapeSessionStatus(browserSessionOnly, NOW).message).toMatch(/does not publish a cookie lifetime/i);
  });

  it("classifies a 401 and a followed sign-in redirect as expiry, not a permission problem", () => {
    const headers = new Headers({ "content-type": "application/json" });
    expect(classifyOnshapeResponse({ status: 401, ok: false, url: "https://cad.onshape.com/api/v6/documents", headers })).toBe("expired");
    expect(
      classifyOnshapeResponse({
        status: 200,
        ok: true,
        redirected: true,
        url: "https://cad.onshape.com/sign-in?redirect=%2Fdocuments",
        headers: new Headers({ "content-type": "text/html" }),
      }),
    ).toBe("expired");
    expect(classifyOnshapeResponse({ status: 403, ok: false, url: "https://cad.onshape.com/api/v6/documents/d/x", headers })).toBe("forbidden");
    expect(classifyOnshapeResponse({ status: 404, ok: false, url: "https://cad.onshape.com/api/v6/x", headers })).toBe("error");
    expect(classifyOnshapeResponse({ status: 200, ok: true, url: "https://cad.onshape.com/api/v6/x", headers })).toBe("ok");
  });

  it("raises the actionable re-login error instead of dumping a 401", async () => {
    const http = createOnshapeSessionHttp(sessionFixture(), {
      now: () => NOW,
      fetchImpl: (async () =>
        jsonResponse({ message: "Unauthorized" }, 401)) as unknown as typeof fetch,
    });
    await expect(http("/users/current")).rejects.toBeInstanceOf(OnshapeSessionExpiredError);
    await expect(http("/users/current")).rejects.toThrow(/vantage-cad login/);

    const noCookies = createOnshapeSessionHttp(sessionFixture(), { now: () => NOW + 48 * HOUR });
    await expect(noCookies("/users/current")).rejects.toThrow(/vantage-cad login/);
  });
});

describe("request shape", () => {
  it("versions bare paths and passes /api paths through", () => {
    expect(onshapeApiUrl("https://cad.onshape.com", "/documents")).toBe("https://cad.onshape.com/api/v6/documents");
    expect(onshapeApiUrl("https://cad.onshape.com/", "documents")).toBe("https://cad.onshape.com/api/v6/documents");
    expect(onshapeApiUrl("https://acme.onshape.com", "/api/v6/users/current")).toBe(
      "https://acme.onshape.com/api/v6/users/current",
    );
  });

  it("sends the cookie header and captured CSRF header, and never an authorization header", async () => {
    let seen: RequestInit | undefined;
    const http = createOnshapeSessionHttp(sessionFixture(), {
      now: () => NOW,
      fetchImpl: (async (_url: string, init: RequestInit) => {
        seen = init;
        return jsonResponse({ id: "u1" });
      }) as unknown as typeof fetch,
    });
    await http("/users/current");
    const headers = seen?.headers as Record<string, string>;
    expect(headers.cookie).toBe("onshape_auth=cookie-value");
    expect(headers["x-xsrf-token"]).toBe("token");
    expect(headers.authorization).toBeUndefined();
  });
});

describe("auth resolution order", () => {
  const withKeys = { ONSHAPE_ACCESS_KEY: "ak", ONSHAPE_SECRET_KEY: "sk" } as NodeJS.ProcessEnv;

  it("prefers the browser session over OAuth and API keys", async () => {
    const resolved = await resolveOnshapeAuth({
      env: withKeys,
      oauthToken: "oauth-token",
      loadSession: async () => sessionFixture(),
      now: () => NOW,
    });
    expect(resolved.authPath).toBe("session");
    expect(resolved.countsAgainstAnnualCap).toBe(false);
    expect(resolved.warning).toBeUndefined();
  });

  it("falls to OAuth before API keys when no session is saved", async () => {
    const resolved = await resolveOnshapeAuth({
      env: withKeys,
      oauthToken: async () => "oauth-token",
      loadSession: async () => null,
      now: () => NOW,
    });
    expect(resolved.authPath).toBe("oauth");
    expect(resolved.countsAgainstAnnualCap).toBe(true);
    expect(resolved.warning).toMatch(/annual allowance/i);
  });

  it("uses API keys last and says so", async () => {
    const resolved = await resolveOnshapeAuth({
      env: withKeys,
      loadSession: async () => null,
      now: () => NOW,
    });
    expect(resolved.authPath).toBe("api-key");
    expect(resolved.countsAgainstAnnualCap).toBe(true);
    expect(resolved.warning).toMatch(/deducted from your Onshape annual allowance/i);
  });

  it("never silently spends the cap after a session lapses", async () => {
    const expired = sessionFixture({
      cookies: [
        {
          name: "onshape_auth",
          value: "v",
          domain: ".onshape.com",
          path: "/",
          expires: (NOW - HOUR) / 1000,
          httpOnly: true,
          secure: true,
        },
      ],
    });
    const withFallback = await resolveOnshapeAuth({
      env: withKeys,
      loadSession: async () => expired,
      now: () => NOW,
    });
    expect(withFallback.authPath).toBe("api-key");
    expect(withFallback.warning).toMatch(/has expired/i);
    expect(withFallback.warning).toMatch(/vantage-cad login/);

    await expect(
      resolveOnshapeAuth({ env: {} as NodeJS.ProcessEnv, loadSession: async () => expired, now: () => NOW }),
    ).rejects.toBeInstanceOf(OnshapeSessionExpiredError);
  });

  it("reports setup_required rather than throwing when nothing is configured", async () => {
    await expect(
      resolveOnshapeAuth({ env: {} as NodeJS.ProcessEnv, loadSession: async () => null }),
    ).rejects.toBeInstanceOf(OnshapeAuthUnavailableError);

    const status = await onshapeAuthStatus({ env: {} as NodeJS.ProcessEnv, loadSession: async () => null });
    expect(status.connected).toBe(false);
    expect(status.setupRequired).toBe(true);
    expect(status.message).toMatch(/vantage-cad login/);
  });

  it("attributes every call it serves to the ledger", async () => {
    const budget = createCallBudget({ now: () => NOW });
    const resolved = await resolveOnshapeAuth({
      env: {} as NodeJS.ProcessEnv,
      budget,
      loadSession: async () => sessionFixture(),
      now: () => NOW,
      fetchImpl: (async () => jsonResponse({ id: "u1", name: "Team 254" })) as unknown as typeof fetch,
    });
    const identity = await probeOnshapeIdentity(resolved.http);
    expect(identity).toEqual({ id: "u1", name: "Team 254" });

    const summary = budget.summary();
    expect(summary.byAuthPath.session).toBe(1);
    expect(summary.annualCapCalls).toBe(0);
    expect(summary.entries[0]?.path).toBe("/users/current");
    expect(summary.headline).toMatch(/^1 session call, 0 API-key calls/);
  });

  it("routes an injected fetch through the API-key path with Basic auth", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const resolved = await resolveOnshapeAuth({
      env: withKeys,
      loadSession: async () => null,
      fetchImpl: (async (url: string, init: RequestInit) => {
        calls.push({ url, headers: init.headers as Record<string, string> });
        return jsonResponse({ id: "u2" });
      }) as unknown as typeof fetch,
    });
    await probeOnshapeIdentity(resolved.http);
    expect(calls[0]?.url).toBe("https://cad.onshape.com/api/v6/users/current");
    expect(calls[0]?.headers.authorization).toBe(`Basic ${Buffer.from("ak:sk").toString("base64")}`);
    expect(resolved.budget.summary().annualCapCalls).toBe(1);
  });
});

describe("session store persistence", () => {
  let home: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "vantage-cad-session-"));
    env = { VANTAGE_CAD_HOME: home } as NodeJS.ProcessEnv;
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("round-trips a saved session across a simulated process restart", async () => {
    const path = await saveOnshapeBrowserSession(sessionFixture({ accountLabel: "Team 254" }), env);
    // A fresh load with no in-memory state is exactly what the next process does.
    const reloaded = await loadOnshapeBrowserSession(env);
    expect(reloaded?.cookies).toHaveLength(2);
    expect(reloaded?.accountLabel).toBe("Team 254");
    expect(reloaded?.headers).toEqual({ "x-xsrf-token": "token" });
    expect(onshapeSessionStatus(reloaded, NOW).connected).toBe(true);

    if (process.platform !== "win32") {
      // Windows does not implement POSIX mode bits; the chmod call is still made.
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    }

    expect(await clearOnshapeBrowserSession(env)).toBe(true);
    expect(await loadOnshapeBrowserSession(env)).toBeNull();
    expect(await clearOnshapeBrowserSession(env)).toBe(false);
  });

  it("drops non-CSRF headers before they reach disk", async () => {
    await saveOnshapeBrowserSession(
      sessionFixture({ headers: { authorization: "Bearer nope", "user-agent": "x", "x-csrf-token": "keep" } }),
      env,
    );
    const raw = await readFile(join(home, "onshape-session.json"), "utf8");
    expect(raw).not.toContain("Bearer nope");
    expect(raw).not.toContain("user-agent");
    expect(JSON.parse(raw).headers).toEqual({ "x-csrf-token": "keep" });
  });

  it("refuses to save an empty session and reports setup_required when none exists", async () => {
    await expect(saveOnshapeBrowserSession(sessionFixture({ cookies: [] }), env)).rejects.toThrow(/no cookies/i);
    const status = onshapeSessionStatus(await loadOnshapeBrowserSession(env), NOW);
    expect(status.setupRequired).toBe(true);
    expect(status.message).toMatch(/vantage-cad login/);
  });
});
