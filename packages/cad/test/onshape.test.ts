import { describe, expect, it } from "vitest";
import {
  buildOnshapeAuthorizeUrl,
  cadOsSupportMatrix,
  createOnshapeOAuthState,
  getOnshapeOAuthConfig,
  isOnshapeOAuthConfigured,
  onshapeSetupStatus,
  verifyOnshapeOAuthState,
} from "../src/onshape";

describe("Onshape hosted setup", () => {
  it("reports setup-required when OAuth env is missing", () => {
    const env = {} as NodeJS.ProcessEnv;
    expect(isOnshapeOAuthConfigured(env)).toBe(false);
    expect(onshapeSetupStatus(env).setupRequired).toBe(true);
    expect(getOnshapeOAuthConfig(env)).toBeNull();
  });

  it("builds authorize URL when configured", () => {
    const env = {
      ONSHAPE_OAUTH_CLIENT_ID: "cid",
      ONSHAPE_OAUTH_CLIENT_SECRET: "csecret",
      BETTER_AUTH_URL: "https://vantage.example",
      BETTER_AUTH_SECRET: "state-secret",
    } as NodeJS.ProcessEnv;
    expect(isOnshapeOAuthConfigured(env)).toBe(true);
    const config = getOnshapeOAuthConfig(env)!;
    const state = createOnshapeOAuthState({ orgId: "org-1", userId: "user-1" }, env);
    const claims = verifyOnshapeOAuthState(state, env);
    expect(claims.orgId).toBe("org-1");
    const url = buildOnshapeAuthorizeUrl(config, state);
    expect(url).toContain("oauth.onshape.com/oauth/authorize");
    expect(url).toContain("client_id=cid");
    expect(url).toContain(encodeURIComponent(config.redirectUri));
  });

  it("documents honest Linux Fusion limits", () => {
    const linux = cadOsSupportMatrix().find((row) => row.os === "linux");
    expect(linux?.fusion360Autodesk).toBe("unsupported");
    expect(linux?.onshapeHosted).toBe("supported");
  });
});
