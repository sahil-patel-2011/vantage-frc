import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GOOGLE_OAUTH_CALLBACK_ORIGIN_DEFAULT,
  email2faSatisfiedByAuthMethod,
  resolveGoogleOAuthCallbackOrigin,
  resolveSessionAuthMethod,
} from "./access-policy";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Google OAuth callback origin", () => {
  it("sends Google the registered callback host on Vercel", () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("GOOGLE_OAUTH_CALLBACK_ORIGIN", "");
    expect(resolveGoogleOAuthCallbackOrigin()).toBe(GOOGLE_OAUTH_CALLBACK_ORIGIN_DEFAULT);
    expect(GOOGLE_OAUTH_CALLBACK_ORIGIN_DEFAULT).toBe("https://vantage-frc-web.vercel.app");
  });

  it("follows a newly registered address, trimmed to its origin", () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("GOOGLE_OAUTH_CALLBACK_ORIGIN", "https://vantagefrc.vercel.app/");
    expect(resolveGoogleOAuthCallbackOrigin()).toBe("https://vantagefrc.vercel.app");
    vi.stubEnv("GOOGLE_OAUTH_CALLBACK_ORIGIN", "not a url");
    expect(resolveGoogleOAuthCallbackOrigin()).toBe(GOOGLE_OAUTH_CALLBACK_ORIGIN_DEFAULT);
  });

  it("stays off for next dev, which calls back to localhost", () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(resolveGoogleOAuthCallbackOrigin()).toBeNull();
  });

  it("counts a proxied Google sign-in as Google for email 2FA", () => {
    const method = resolveSessionAuthMethod("/api/auth/oauth-proxy-callback");
    expect(method).toBe("google");
    expect(email2faSatisfiedByAuthMethod(method, true)).toBe(true);
  });
});
