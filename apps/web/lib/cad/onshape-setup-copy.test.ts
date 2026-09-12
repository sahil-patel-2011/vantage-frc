import { describe, expect, it } from "vitest";
import {
  hostedOnshapeAgentStatus,
  hostedOnshapeEnvStatus,
  hostedOnshapeSetup,
  studentOnshapeApiSetup,
  ONSHAPE_HOSTED_BADGE,
  ONSHAPE_HOSTED_UNCONFIGURED_TITLE,
  ONSHAPE_LOCAL_PLAYWRIGHT_HINT,
  ONSHAPE_NO_INVENTED_EXPORTS,
  ONSHAPE_OAUTH_CTA,
  ONSHAPE_PLATFORM_HINT_CONFIGURED,
  ONSHAPE_PLATFORM_HINT_UNCONFIGURED,
  onshapeHostedBadge,
  onshapeOauthCtaEnabled,
  withLocalPlaywrightHint,
} from "./onshape-setup-copy";

const ALL_COPY = [
  ONSHAPE_HOSTED_UNCONFIGURED_TITLE,
  ONSHAPE_LOCAL_PLAYWRIGHT_HINT,
  ONSHAPE_NO_INVENTED_EXPORTS,
  ONSHAPE_OAUTH_CTA.connect,
  ONSHAPE_OAUTH_CTA.reconnect,
  ONSHAPE_OAUTH_CTA.disabledTitle,
  ONSHAPE_OAUTH_CTA.disabledDetail,
  ONSHAPE_PLATFORM_HINT_CONFIGURED,
  ONSHAPE_PLATFORM_HINT_UNCONFIGURED,
  ONSHAPE_HOSTED_BADGE.connected,
  ONSHAPE_HOSTED_BADGE.oauthReady,
  ONSHAPE_HOSTED_BADGE.adminSetup,
].join(" ");

describe("hosted Onshape setup copy", () => {
  it("student CAD APIs omit operator env names and callback URLs", () => {
    const setup = studentOnshapeApiSetup({});
    expect(setup.setupRequired).toBe(true);
    expect(setup.connectCtaEnabled).toBe(false);
    expect(setup.message).toMatch(/Ask a mentor/);
    expect(setup.message).not.toMatch(/Setup required|ONSHAPE_|Vercel|callback/i);
    expect(setup).not.toHaveProperty("missingEnv");
    expect(setup).not.toHaveProperty("callbackUrl");
    expect(setup).not.toHaveProperty("redirectUri");
  });

  it("reports setup_required when OAuth and API-key env are missing", () => {
    const status = hostedOnshapeEnvStatus({});
    expect(status.setupRequired).toBe(true);
    expect(status.status).toBe("setup_required");
    expect(status.configured).toBe(false);
    expect(status.reason).toBe("missing_env");
    expect(status.connectCtaEnabled).toBe(false);
    expect(status.localPlaywrightAvailable).toBe(true);
    expect(status.message).toMatch(/Onshape isn't ready/i);
    expect(status.message).toMatch(/CAD Connections/);
    expect(status.message).not.toMatch(/ONSHAPE_OAUTH_CLIENT_ID|vantage-cad login/);
    expect(status.bannerTitle).toBe(ONSHAPE_HOSTED_UNCONFIGURED_TITLE);
  });

  it("is not setup_required when OAuth env is configured", () => {
    const status = hostedOnshapeEnvStatus({
      ONSHAPE_OAUTH_CLIENT_ID: "cid",
      ONSHAPE_OAUTH_CLIENT_SECRET: "csecret",
    });
    expect(status.setupRequired).toBe(false);
    expect(status.status).toBe("ready");
    expect(status.configured).toBe(true);
    expect(status.reason).toBe("oauth_ready");
    expect(status.connectCtaEnabled).toBe(true);
    expect(status.localPlaywrightAvailable).toBe(true);
    expect(status.message).not.toMatch(/Setup required/i);
  });

  it("is setup_required when only server API keys are configured", () => {
    const status = hostedOnshapeEnvStatus({
      ONSHAPE_ACCESS_KEY: "access",
      ONSHAPE_SECRET_KEY: "secret",
    });
    expect(status.setupRequired).toBe(true);
    expect(status.status).toBe("setup_required");
    expect(status.configured).toBe(false);
    expect(status.reason).toBe("missing_env");
    expect(status.connectCtaEnabled).toBe(false);
    expect(status.message).toMatch(/Onshape isn't ready/i);
    expect(status.message).not.toMatch(/CLI last-resort|API keys are configured/i);
  });

  it("treats whitespace-only OAuth env as missing", () => {
    const status = hostedOnshapeSetup({
      oauthConfigured: false,
      apiKeyConfigured: false,
    });
    expect(hostedOnshapeEnvStatus({ ONSHAPE_OAUTH_CLIENT_ID: "  ", ONSHAPE_OAUTH_CLIENT_SECRET: "  " })).toEqual(
      status,
    );
    expect(status.setupRequired).toBe(true);
  });

  it("keeps the hosted agent setup_required when OAuth env exists but the user session is missing", () => {
    const status = hostedOnshapeAgentStatus({
      oauthConfigured: true,
      apiKeyConfigured: false,
      sessionConnected: false,
    });
    expect(status.setupRequired).toBe(true);
    expect(status.status).toBe("setup_required");
    expect(status.reason).toBe("missing_session");
    expect(status.connectCtaEnabled).toBe(true);
    expect(status.message).toMatch(/Connect Onshape/);
    expect(status.message).toMatch(/CAD Connections/);
    expect(status.message).not.toMatch(/vantage-cad login|ONSHAPE_OAUTH/);
  });

  it("is ready for the hosted agent only when OAuth is configured and a session exists", () => {
    expect(
      hostedOnshapeAgentStatus({
        oauthConfigured: true,
        apiKeyConfigured: false,
        sessionConnected: true,
      }).setupRequired,
    ).toBe(false);
    expect(
      hostedOnshapeAgentStatus({
        oauthConfigured: false,
        apiKeyConfigured: true,
        sessionConnected: false,
      }).setupRequired,
    ).toBe(true);
    expect(
      hostedOnshapeAgentStatus({
        oauthConfigured: false,
        apiKeyConfigured: true,
        sessionConnected: true,
      }).reason,
    ).toBe("missing_env");
  });

  it("never uses API keys as a connected or ready badge", () => {
    expect(onshapeHostedBadge({ sessionConnected: false, oauthCtaEnabled: false }).label).toBe(
      ONSHAPE_HOSTED_BADGE.adminSetup,
    );
    expect(onshapeHostedBadge({ sessionConnected: false, oauthCtaEnabled: true }).label).toBe(
      ONSHAPE_HOSTED_BADGE.oauthReady,
    );
    expect(onshapeHostedBadge({ sessionConnected: true, oauthCtaEnabled: false }).label).toBe(
      ONSHAPE_HOSTED_BADGE.connected,
    );
    expect(ALL_COPY).not.toMatch(/API keys ready/i);
    expect(ONSHAPE_HOSTED_BADGE.adminSetup).not.toMatch(/API keys/i);
  });

  it("enables the OAuth CTA only when the OAuth client is actually present", () => {
    expect(onshapeOauthCtaEnabled(null)).toBe(false);
    expect(onshapeOauthCtaEnabled({ configured: true, redirectUri: null, scopes: [] })).toBe(false);
    expect(onshapeOauthCtaEnabled({ configured: true, redirectUri: "https://app.example/callback" })).toBe(true);
    expect(onshapeOauthCtaEnabled({ configured: true, scopes: ["OAuth2Read"] })).toBe(true);
    expect(onshapeOauthCtaEnabled({ configured: true, setupRequired: false })).toBe(true);
    expect(onshapeOauthCtaEnabled({ configured: false, connectCtaEnabled: true })).toBe(true);
    expect(onshapeOauthCtaEnabled({ configured: true, connectCtaEnabled: false })).toBe(false);
  });

  it("keeps student CAD copy free of env vars and never invents STL or documents", () => {
    expect(withLocalPlaywrightHint("Ask a mentor to finish Onshape setup.")).toContain("desktop CAD app");
    expect(withLocalPlaywrightHint(ONSHAPE_LOCAL_PLAYWRIGHT_HINT)).toBe(ONSHAPE_LOCAL_PLAYWRIGHT_HINT);
    expect(ONSHAPE_OAUTH_CTA.connect).toBe("Connect Onshape");
    expect(ALL_COPY).not.toMatch(/ONSHAPE_OAUTH_CLIENT_ID|vantage-cad login|Vercel/);
    expect(ALL_COPY).not.toMatch(/OAuth ready|Admin setup|Hosted Onshape is not configured/);

    const spoken = `${ALL_COPY} ${hostedOnshapeEnvStatus({}).message} ${
      hostedOnshapeAgentStatus({
        oauthConfigured: true,
        apiKeyConfigured: false,
        sessionConnected: false,
      }).message
    }`;
    expect(spoken).not.toMatch(/demo stl|sample document|placeholder export|invented geometry/i);
    expect(ONSHAPE_NO_INVENTED_EXPORTS).toMatch(/appear only after a real connected run/i);
    expect(ONSHAPE_LOCAL_PLAYWRIGHT_HINT).toMatch(/desktop CAD app/);
  });
});
