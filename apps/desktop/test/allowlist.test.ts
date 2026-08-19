import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRODUCTION_ORIGIN,
  isAllowedAppOrigin,
  isAllowedNavigation,
  sanitizeAppOrigin,
  shouldOpenExternally,
  stripElectronUserAgent,
} from "../src/allowlist";

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
    expect(isAllowedNavigation("about:blank")).toBe(true);
    expect(shouldOpenExternally("file:///C:/app/offline.html")).toBe(false);
    expect(shouldOpenExternally("https://example.com")).toBe(true);
  });

  it("drops a hostile VANTAGE_URL", () => {
    expect(sanitizeAppOrigin(undefined)).toBe(DEFAULT_PRODUCTION_ORIGIN);
    expect(sanitizeAppOrigin("https://phish.example")).toBe(DEFAULT_PRODUCTION_ORIGIN);
    expect(sanitizeAppOrigin("http://localhost:3001/extra")).toBe("http://localhost:3001");
  });

  it("strips Electron from the UA so Google OAuth is not treated as an embedded WebView", () => {
    const next = stripElectronUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Electron/36.0.0 Safari/537.36",
    );
    expect(next).not.toMatch(/Electron/i);
    expect(next).toContain("Chrome/126");
  });
});
