/**
 * The GitHub connector against a mocked provider — no real network, no
 * credentials. Covers the four things that were broken:
 *
 *   1. the callback URL was unreadable until the credentials existed;
 *   2. "OAuth App not configured" named no variable;
 *   3. a revoked token surfaced as a raw "Bad credentials" next to a card
 *      still reading LINKED;
 *   4. a rate limit was indistinguishable from a revocation, so the advice
 *      would have been to throw away a working token.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GitHubCredentialRejectedError,
  createGitHubHttp,
  fetchGitHubRepoMeta,
  fetchGitHubUser,
  isGitHubCredentialRejected,
  listGitHubRepos,
} from "./api";
import {
  buildGitHubAuthorizeUrl,
  createGitHubOAuthState,
  exchangeGitHubCode,
  getGitHubOAuthConfig,
  githubCallbackUrl,
  githubMissingEnv,
  githubSetupStatus,
  verifyGitHubOAuthState,
} from "./oauth";

const CONFIGURED = {
  BETTER_AUTH_URL: "https://vantage.example.com",
  GITHUB_OAUTH_CLIENT_ID: "Iv1.abc",
  GITHUB_OAUTH_CLIENT_SECRET: "shhh",
} as NodeJS.ProcessEnv;

function jsonResponse(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("callback URL is readable before any credential exists", () => {
  it("computes the Authorization callback URL from the base URL alone", () => {
    expect(githubCallbackUrl({ BETTER_AUTH_URL: "https://vantage.example.com" } as NodeJS.ProcessEnv)).toBe(
      "https://vantage.example.com/api/github/oauth/callback",
    );
  });

  it("still gives one when the OAuth App has not been created yet", () => {
    const status = githubSetupStatus({ BETTER_AUTH_URL: "https://vantage.example.com" } as NodeJS.ProcessEnv);
    expect(status.configured).toBe(false);
    expect(status.callbackUrl).toBe("https://vantage.example.com/api/github/oauth/callback");
  });

  it("honours an explicit GITHUB_OAUTH_REDIRECT_URI on both paths", () => {
    const env = { ...CONFIGURED, GITHUB_OAUTH_REDIRECT_URI: "https://alt.example.com/cb" } as NodeJS.ProcessEnv;
    expect(githubCallbackUrl(env)).toBe("https://alt.example.com/cb");
    expect(getGitHubOAuthConfig(env)?.redirectUri).toBe("https://alt.example.com/cb");
  });
});

describe("the unconfigured message is actionable", () => {
  it("names both missing variables", () => {
    expect(githubMissingEnv({} as NodeJS.ProcessEnv)).toEqual([
      "GITHUB_OAUTH_CLIENT_ID",
      "GITHUB_OAUTH_CLIENT_SECRET",
    ]);
  });

  it("names the variables, where to set them, the console and the URL", () => {
    const message = githubSetupStatus({ BETTER_AUTH_URL: "https://vantage.example.com" } as NodeJS.ProcessEnv)
      .message;
    expect(message).toContain("GITHUB_OAUTH_CLIENT_ID");
    expect(message).toContain("GITHUB_OAUTH_CLIENT_SECRET");
    expect(message).toContain("Environment Variables");
    expect(message).toContain("OAuth Apps");
    expect(message).toContain("https://vantage.example.com/api/github/oauth/callback");
  });

  it("keeps saying the PAT path still works, because it does", () => {
    const status = githubSetupStatus({} as NodeJS.ProcessEnv);
    expect(status.patAvailable).toBe(true);
    expect(status.setupRequired).toBe(false);
    expect(status.message.toLowerCase()).toContain("pat");
  });

  it("reports the registered URL once configured, so a mismatch is visible", () => {
    const status = githubSetupStatus(CONFIGURED);
    expect(status.configured).toBe(true);
    expect(status.message).toContain("https://vantage.example.com/api/github/oauth/callback");
    expect(status.missingEnv).toEqual([]);
  });
});

describe("authorize URL and state", () => {
  it("sends the client id, the redirect, the scopes and the state", () => {
    const state = createGitHubOAuthState({ orgId: "org-1", userId: "user-1" }, CONFIGURED);
    const url = new URL(buildGitHubAuthorizeUrl(getGitHubOAuthConfig(CONFIGURED)!, state));
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("Iv1.abc");
    expect(url.searchParams.get("redirect_uri")).toBe("https://vantage.example.com/api/github/oauth/callback");
    expect(url.searchParams.get("scope")).toBe("read:user repo");
    expect(url.searchParams.get("state")).toBe(state);
  });

  it("rejects a state signed with a different secret — the CSRF guard", () => {
    const state = createGitHubOAuthState({ orgId: "org-1", userId: "user-1" }, {
      BETTER_AUTH_SECRET: "secret-a",
    } as NodeJS.ProcessEnv);
    expect(() => verifyGitHubOAuthState(state, { BETTER_AUTH_SECRET: "secret-b" } as NodeJS.ProcessEnv)).toThrow(
      /state signature/i,
    );
  });

  it("rejects a tampered payload even with the right secret", () => {
    const env = { BETTER_AUTH_SECRET: "secret-a" } as NodeJS.ProcessEnv;
    const state = createGitHubOAuthState({ orgId: "org-1", userId: "user-1" }, env);
    const [body, sig] = state.split(".");
    const forged = Buffer.from(
      JSON.stringify({ orgId: "org-EVIL", userId: "user-1", nonce: "n", issuedAt: Date.now() }),
      "utf8",
    ).toString("base64url");
    expect(body).not.toBe(forged);
    expect(() => verifyGitHubOAuthState(`${forged}.${sig}`, env)).toThrow(/state signature/i);
  });

  it("rejects a state older than its window", () => {
    const env = { BETTER_AUTH_SECRET: "secret-a" } as NodeJS.ProcessEnv;
    const state = createGitHubOAuthState({ orgId: "org-1", userId: "user-1" }, env);
    expect(() => verifyGitHubOAuthState(state, env, -1)).toThrow(/expired/i);
  });
});

describe("token exchange against a mocked GitHub", () => {
  it("posts the code and the registered redirect, and reads the token back", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url: String(url), body: String(init.body) });
        return jsonResponse({ access_token: "gho_live", token_type: "bearer", scope: "read:user,repo" });
      }),
    );

    const tokens = await exchangeGitHubCode(getGitHubOAuthConfig(CONFIGURED)!, "code-123");
    expect(tokens.accessToken).toBe("gho_live");
    expect(tokens.tokenType).toBe("bearer");
    expect(calls[0]!.url).toBe("https://github.com/login/oauth/access_token");
    const sent = new URLSearchParams(calls[0]!.body);
    expect(sent.get("code")).toBe("code-123");
    expect(sent.get("client_id")).toBe("Iv1.abc");
    expect(sent.get("redirect_uri")).toBe("https://vantage.example.com/api/github/oauth/callback");
  });

  it("surfaces GitHub's own error description rather than a generic failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ error: "bad_verification_code", error_description: "The code passed is incorrect." }),
      ),
    );
    await expect(exchangeGitHubCode(getGitHubOAuthConfig(CONFIGURED)!, "stale")).rejects.toThrow(
      /The code passed is incorrect/,
    );
  });

  it("never leaks the client secret into the thrown message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "bad_verification_code" })));
    await expect(exchangeGitHubCode(getGitHubOAuthConfig(CONFIGURED)!, "stale")).rejects.toThrow(
      expect.not.stringContaining("shhh") as unknown as string,
    );
  });
});

describe("a rejected credential is told apart from every other failure", () => {
  it("turns 401 Bad credentials into the typed error, with advice", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ message: "Bad credentials" }, { status: 401 })));
    const error = await fetchGitHubUser(createGitHubHttp("dead")).catch((e: unknown) => e);
    expect(isGitHubCredentialRejected(error)).toBe(true);
    expect((error as Error).message).toContain("Bad credentials");
    expect((error as Error).message).toMatch(/connect again/i);
  });

  it("treats a scope-less 403 as a credential problem", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ message: "Resource not accessible by personal access token" }, {
          status: 403,
          headers: { "x-ratelimit-remaining": "4998" },
        }),
      ),
    );
    const error = await listGitHubRepos(createGitHubHttp("narrow")).catch((e: unknown) => e);
    expect(isGitHubCredentialRejected(error)).toBe(true);
  });

  it("does NOT call a rate limit a revocation — that would bin a working token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ message: "API rate limit exceeded" }, {
          status: 403,
          headers: { "x-ratelimit-remaining": "0" },
        }),
      ),
    );
    const error = await listGitHubRepos(createGitHubHttp("fine")).catch((e: unknown) => e);
    expect(isGitHubCredentialRejected(error)).toBe(false);
    expect((error as Error).message).toContain("rate limit");
  });

  it("leaves a plain 404 alone — a missing repo is not a dead token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ message: "Not Found" }, { status: 404 })));
    const error = await fetchGitHubRepoMeta(createGitHubHttp("ok"), "team/robot").catch((e: unknown) => e);
    expect(isGitHubCredentialRejected(error)).toBe(false);
    expect((error as Error).message).toBe("Not Found");
  });

  it("reads the repo metadata a default-repo binding stores", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          full_name: "team3005/robot-2026",
          default_branch: "main",
          private: true,
          html_url: "https://github.com/team3005/robot-2026",
        }),
      ),
    );
    const meta = await fetchGitHubRepoMeta(createGitHubHttp("gho_live"), "team3005/robot-2026");
    expect(meta).toEqual({
      fullName: "team3005/robot-2026",
      defaultBranch: "main",
      private: true,
      htmlUrl: "https://github.com/team3005/robot-2026",
    });
  });

  it("sends the token as a bearer with GitHub's required headers", async () => {
    const seen: RequestInit[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        seen.push(init);
        return jsonResponse({ login: "octocat", id: 1 });
      }),
    );
    await fetchGitHubUser(createGitHubHttp("gho_live"));
    const headers = seen[0]!.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer gho_live");
    expect(headers["x-github-api-version"]).toBe("2022-11-28");
  });

  it("carries the provider status so a caller can log it", () => {
    const error = new GitHubCredentialRejectedError(401, "Bad credentials");
    expect(error.status).toBe(401);
    expect(error.name).toBe("GitHubCredentialRejectedError");
  });
});
