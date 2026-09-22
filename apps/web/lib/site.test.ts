import { describe, expect, it } from "vitest";
import { LIVE_AUTH_ORIGIN, PRODUCTION_AUTH_ALIASES } from "@vantage/core";
import { PRODUCTION_APP_HOSTS } from "../../desktop/src/allowlist";
import { LIVE_SITE_ORIGIN, resolveSiteUrl } from "./site";

/**
 * Where the product says it lives.
 *
 * Four places had an opinion about that — the site canonical, the auth
 * callback, the desktop shell's allowlist, and the Vercel environment — and
 * they had drifted apart. `vantage-frc-web.vercel.app` is retired and answers
 * `DEPLOYMENT_NOT_FOUND`; auth had been taught that and rewrote it, the other
 * three had not. So production shipped `<link rel="canonical">` and `og:url`
 * pointing at a hostname that does not resolve, with `robots: index, follow`,
 * and the desktop app opened on it and refused every host that did work.
 *
 * None of that raised an error anywhere. These tests exist because the failure
 * mode is silence.
 */
describe("where the product says it lives", () => {
  it("agrees with the auth layer about the live origin", () => {
    expect(
      LIVE_SITE_ORIGIN,
      "the site canonical and the auth callback must name the same host",
    ).toBe(LIVE_AUTH_ORIGIN);
  });

  it("offers the desktop shell every host Better Auth trusts", () => {
    // A host the browser trusts but the shell refuses is indistinguishable
    // from the app being down, so the shell's list must cover the vanity hosts.
    const trusted = new Set(PRODUCTION_AUTH_ALIASES.map((origin) => new URL(origin).hostname));
    for (const host of PRODUCTION_APP_HOSTS) {
      expect(trusted.has(host), `${host} is in the desktop allowlist but not trusted by auth`).toBe(true);
    }
  });

  it("never points the desktop shell at a retired host", () => {
    expect(PRODUCTION_APP_HOSTS as readonly string[]).not.toContain("vantage-frc-web.vercel.app");
  });
});

describe("resolveSiteUrl", () => {
  it("rewrites the retired host rather than publishing it", () => {
    expect(
      resolveSiteUrl({ NEXT_PUBLIC_APP_URL: "https://vantage-frc-web.vercel.app" }),
      "a dead host must never reach a canonical tag",
    ).toBe("https://vantagefrc.vercel.app");
  });

  it("honours a real custom domain untouched", () => {
    expect(resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: "https://vantage.example.org" })).toBe(
      "https://vantage.example.org",
    );
  });

  it("drops a trailing slash so URLs do not double up", () => {
    expect(resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: "https://vantage.example.org/" })).toBe(
      "https://vantage.example.org",
    );
  });

  it("prefers an explicit site URL over the app URL", () => {
    expect(
      resolveSiteUrl({
        NEXT_PUBLIC_SITE_URL: "https://vantage.example.org",
        NEXT_PUBLIC_APP_URL: "https://vantage-frc-web.vercel.app",
      }),
    ).toBe("https://vantage.example.org");
  });

  it("uses the Vercel production host when nothing is configured", () => {
    expect(resolveSiteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "frcvantage.vercel.app" })).toBe(
      "https://frcvantage.vercel.app",
    );
  });

  it("falls back to the live origin, not the retired one", () => {
    expect(resolveSiteUrl({})).toBe("https://vantagefrc.vercel.app");
  });
});
