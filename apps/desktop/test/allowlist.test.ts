import { describe, expect, it } from "vitest";
import {
  cookieMatchesHost,
  DEFAULT_PRODUCTION_ORIGIN,
  isAllowedAppOrigin,
  isAllowedNavigation,
  isAllowedWhileSignedOut,
  isLoopbackOrigin,
  isSessionCookieName,
  parseDeepLinkPath,
  sanitizeAppOrigin,
  shouldOpenExternally,
  stripElectronUserAgent,
} from "../src/allowlist";
import {
  DEFAULT_WINDOW_STATE,
  parseWindowState,
  sanitizeWindowState,
} from "../src/window-state";

describe("desktop navigation allowlist", () => {
  it("starts on production or loopback only", () => {
    expect(isAllowedAppOrigin(new URL(DEFAULT_PRODUCTION_ORIGIN))).toBe(true);
    expect(isAllowedAppOrigin(new URL("http://localhost:3001"))).toBe(true);
    expect(isAllowedAppOrigin(new URL("https://evil.example"))).toBe(false);
    expect(isAllowedAppOrigin(new URL("https://random.vercel.app"))).toBe(false);
  });

  it("allows Google / Stripe / Onshape hosts used by sign-in and billing", () => {
    expect(isAllowedNavigation("https://accounts.google.com/o/oauth2/v2/auth")).toBe(true);
    expect(isAllowedNavigation("https://checkout.stripe.com/c/pay/cs_test")).toBe(true);
    expect(isAllowedNavigation("https://cad.onshape.com/signin")).toBe(true);
    expect(isAllowedNavigation("https://github.com/login")).toBe(true);
    expect(isAllowedNavigation("https://attacker.example/phish")).toBe(false);
    expect(isAllowedNavigation("file:///etc/passwd")).toBe(false);
    expect(isAllowedNavigation("file:///C:/app/offline.html")).toBe(true);
    expect(isAllowedNavigation("file:///C:/app/gate.html")).toBe(true);
    expect(isAllowedNavigation("about:blank")).toBe(true);
    expect(shouldOpenExternally("file:///C:/app/offline.html")).toBe(false);
    expect(shouldOpenExternally("https://example.com")).toBe(true);
  });

  it("drops a hostile VANTAGE_URL", () => {
    expect(sanitizeAppOrigin(undefined)).toBe(DEFAULT_PRODUCTION_ORIGIN);
    expect(sanitizeAppOrigin("https://phish.example")).toBe(DEFAULT_PRODUCTION_ORIGIN);
    expect(sanitizeAppOrigin("http://localhost:3001/extra")).toBe("http://localhost:3001");
  });

  it("treats IPv6 loopback as a mentor override, not production", () => {
    expect(isLoopbackOrigin("http://[::1]:3001")).toBe(true);
    expect(sanitizeAppOrigin("http://[::1]:3001/path")).toBe("http://[::1]:3001");
  });

  it("recognizes only the Better Auth session cookie", () => {
    expect(isSessionCookieName("better-auth.session_token")).toBe(true);
    expect(isSessionCookieName("__Secure-better-auth.session_token")).toBe(true);
    expect(isSessionCookieName("better-auth.csrf_token")).toBe(false);
    expect(isSessionCookieName("session_token")).toBe(false);
  });

  it("domain-matches cookies against the app host only", () => {
    expect(cookieMatchesHost("vantage-frc-web.vercel.app", "vantage-frc-web.vercel.app")).toBe(true);
    expect(cookieMatchesHost(".vantage-frc-web.vercel.app", "vantage-frc-web.vercel.app")).toBe(true);
    expect(cookieMatchesHost("localhost", "localhost")).toBe(true);
    expect(cookieMatchesHost("evil.example", "vantage-frc-web.vercel.app")).toBe(false);
    expect(cookieMatchesHost(undefined, "vantage-frc-web.vercel.app")).toBe(false);
    expect(cookieMatchesHost("", "vantage-frc-web.vercel.app")).toBe(false);
  });

  it("gates a signed-out session to the sign-in flow and public pages", () => {
    const origin = DEFAULT_PRODUCTION_ORIGIN;
    expect(isAllowedWhileSignedOut(`${origin}/signin`, origin)).toBe(true);
    expect(isAllowedWhileSignedOut(`${origin}/`, origin)).toBe(true);
    expect(isAllowedWhileSignedOut(`${origin}/pricing`, origin)).toBe(true);
    expect(isAllowedWhileSignedOut(`${origin}/api/auth/callback/google`, origin)).toBe(true);
    expect(isAllowedWhileSignedOut(`${origin}/invite/abc123`, origin)).toBe(true);
    expect(isAllowedWhileSignedOut("https://accounts.google.com/o/oauth2/v2/auth", origin)).toBe(true);
    expect(isAllowedWhileSignedOut("file:///C:/app/gate.html", origin)).toBe(true);
    // Gated product surfaces are blocked until a session cookie exists.
    expect(isAllowedWhileSignedOut(`${origin}/dashboard`, origin)).toBe(false);
    expect(isAllowedWhileSignedOut(`${origin}/build`, origin)).toBe(false);
    expect(isAllowedWhileSignedOut(`${origin}/admin`, origin)).toBe(false);
    // Non-sign-in third parties are blocked while signed out.
    expect(isAllowedWhileSignedOut("https://checkout.stripe.com/c/pay/x", origin)).toBe(false);
    expect(isAllowedWhileSignedOut("https://github.com/login", origin)).toBe(false);
    // Never widens the base allowlist.
    expect(isAllowedWhileSignedOut("https://attacker.example/signin", origin)).toBe(false);
  });

  it("keeps localhost dev usable while signed out", () => {
    expect(isAllowedWhileSignedOut("http://localhost:3001/signin", "http://localhost:3001")).toBe(true);
    expect(isAllowedWhileSignedOut("http://localhost:3001/dashboard", "http://localhost:3001")).toBe(false);
  });

  it("parses vantage-frc:// deep links into safe app paths", () => {
    expect(parseDeepLinkPath("vantage-frc://open/dashboard")).toBe("/dashboard");
    expect(parseDeepLinkPath("vantage-frc://open/build?tab=cad")).toBe("/build?tab=cad");
    expect(parseDeepLinkPath("vantage-frc:///scouting")).toBe("/scouting");
    expect(parseDeepLinkPath("vantage-frc://open/")).toBe("/");
    expect(parseDeepLinkPath("https://evil.example/x")).toBe(null);
    expect(parseDeepLinkPath("vantage-frc://evil/dashboard")).toBe(null);
    // WHATWG URL normalizes dot segments before our checks; backslashes are rejected.
    expect(parseDeepLinkPath("vantage-frc://open/../etc")).toBe("/etc");
    expect(parseDeepLinkPath("vantage-frc://open/a\\b")).toBe(null);
    expect(parseDeepLinkPath("not a url")).toBe(null);
  });

  it("strips Electron from the UA so Google OAuth is not treated as an embedded WebView", () => {
    const next = stripElectronUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Electron/36.0.0 Safari/537.36",
    );
    expect(next).not.toMatch(/Electron/i);
    expect(next).toContain("Chrome/126");
  });
});

describe("window state restore", () => {
  const display = { x: 0, y: 0, width: 2560, height: 1440 };

  it("keeps a saved position that is still on a display", () => {
    const state = sanitizeWindowState({ width: 1600, height: 1000, x: 120, y: 80 }, [display]);
    expect(state).toEqual({ width: 1600, height: 1000, x: 120, y: 80 });
  });

  it("drops the position (but keeps the size) after a monitor is unplugged", () => {
    const state = sanitizeWindowState({ width: 1600, height: 1000, x: -4000, y: 80 }, [display]);
    expect(state.width).toBe(1600);
    expect(state.x).toBeUndefined();
    expect(state.y).toBeUndefined();
  });

  it("clamps to minimums and survives corrupt input", () => {
    expect(sanitizeWindowState({ width: 200, height: 100 }, [display])).toEqual({
      width: 1024,
      height: 720,
    });
    expect(sanitizeWindowState("garbage", [display])).toEqual(DEFAULT_WINDOW_STATE);
    expect(parseWindowState("{not json", [display])).toEqual(DEFAULT_WINDOW_STATE);
    expect(parseWindowState(undefined, [display])).toEqual(DEFAULT_WINDOW_STATE);
  });

  it("preserves maximized", () => {
    const state = sanitizeWindowState({ width: 1440, height: 920, maximized: true }, [display]);
    expect(state.maximized).toBe(true);
  });
});
