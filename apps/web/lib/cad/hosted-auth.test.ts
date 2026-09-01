import { afterEach, describe, expect, it } from "vitest";
import {
  hostedOnshapeAgentAuth,
  hostedOnshapeAuthFromEnv,
  hostedOnshapeEnvAuth,
  isHostedOnshapeConnected,
  readHostedOnshapeEnvFlags,
} from "./hosted-auth";

const ORIGINAL = {
  ONSHAPE_ACCESS_KEY: process.env.ONSHAPE_ACCESS_KEY,
  ONSHAPE_SECRET_KEY: process.env.ONSHAPE_SECRET_KEY,
  ONSHAPE_API_KEY: process.env.ONSHAPE_API_KEY,
  ONSHAPE_API_SECRET: process.env.ONSHAPE_API_SECRET,
  ONSHAPE_OAUTH_CLIENT_ID: process.env.ONSHAPE_OAUTH_CLIENT_ID,
  ONSHAPE_OAUTH_CLIENT_SECRET: process.env.ONSHAPE_OAUTH_CLIENT_SECRET,
};

afterEach(() => {
  for (const [name, value] of Object.entries(ORIGINAL)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("hosted Onshape auth policy", () => {
  it("treats keys-only env as setup_required and not connected", () => {
    const env = {
      ONSHAPE_ACCESS_KEY: "test-access",
      ONSHAPE_SECRET_KEY: "test-secret",
    };
    const flags = readHostedOnshapeEnvFlags(env);
    expect(flags.apiKeyConfigured).toBe(true);
    expect(flags.oauthConfigured).toBe(false);

    const envAuth = hostedOnshapeEnvAuth(flags);
    expect(envAuth.setupRequired).toBe(true);
    expect(envAuth.connected).toBe(false);
    expect(envAuth.reason).toBe("missing_oauth_env");
    expect(envAuth.via).toBeNull();

    const agent = hostedOnshapeAgentAuth({ ...flags, sessionConnected: false });
    expect(agent.setupRequired).toBe(true);
    expect(agent.connected).toBe(false);
    expect(isHostedOnshapeConnected({ ...flags, sessionConnected: false })).toBe(false);
    expect(isHostedOnshapeConnected({ ...flags, sessionConnected: true })).toBe(false);

    const fromEnv = hostedOnshapeAuthFromEnv(env, false);
    expect(fromEnv.setupRequired).toBe(true);
    expect(fromEnv.connected).toBe(false);
  });

  it("is not setup_required when OAuth is configured and a session exists", () => {
    const auth = hostedOnshapeAgentAuth({
      oauthConfigured: true,
      apiKeyConfigured: false,
      sessionConnected: true,
    });
    expect(auth.setupRequired).toBe(false);
    expect(auth.status).toBe("ready");
    expect(auth.configured).toBe(true);
    expect(auth.connected).toBe(true);
    expect(auth.reason).toBe("oauth_connected");
    expect(auth.via).toBe("oauth");
    expect(isHostedOnshapeConnected({ oauthConfigured: true, sessionConnected: true })).toBe(true);
  });

  it("does not treat keys-only as connected even with a cad_connections row", () => {
    expect(
      isHostedOnshapeConnected({
        oauthConfigured: false,
        apiKeyConfigured: true,
        sessionConnected: true,
      }),
    ).toBe(false);
    expect(
      hostedOnshapeAgentAuth({
        oauthConfigured: false,
        apiKeyConfigured: true,
        sessionConnected: true,
      }).connected,
    ).toBe(false);
  });

  it("keeps OAuth env without a session as setup_required for the hosted agent", () => {
    const auth = hostedOnshapeAgentAuth({
      oauthConfigured: true,
      apiKeyConfigured: true,
      sessionConnected: false,
    });
    expect(auth.setupRequired).toBe(true);
    expect(auth.connected).toBe(false);
    expect(auth.reason).toBe("missing_session");
    expect(hostedOnshapeEnvAuth({ oauthConfigured: true, apiKeyConfigured: true }).setupRequired).toBe(false);
  });
});
