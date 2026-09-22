import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  crossProductHref,
  isScoutingPath,
  productForHost,
  productRedirect,
  productsSplitAcrossHosts,
  scoutingTwin,
} from "./products";

describe("products on one host (dev, previews)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_VANTAGE_ORIGIN", "");
    vi.stubEnv("NEXT_PUBLIC_SCOUTING_ORIGIN", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("serves everything and links Scouting by path", () => {
    expect(productsSplitAcrossHosts()).toBe(false);
    expect(productForHost("localhost:3401")).toBe("vantage");
    expect(productRedirect({ host: "localhost:3401", pathname: "/dashboard", search: "" })).toBeNull();
    expect(crossProductHref("scouting", "/scout", "org-1")).toBe("/scout?orgId=org-1");
  });
});

describe("products split across two hosts", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_VANTAGE_ORIGIN", "https://vantagefrc.vercel.app");
    vi.stubEnv("NEXT_PUBLIC_SCOUTING_ORIGIN", "https://vantagefrc-scouting.vercel.app");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("knows which product a host is", () => {
    expect(productsSplitAcrossHosts()).toBe(true);
    expect(productForHost("vantagefrc-scouting.vercel.app")).toBe("scouting");
    expect(productForHost("VANTAGEFRC-SCOUTING.vercel.app")).toBe("scouting");
    expect(productForHost("vantagefrc.vercel.app")).toBe("vantage");
    expect(productForHost("anything-else.example")).toBe("vantage");
  });

  it("opens Scouting's own home at the bare Scouting host", () => {
    expect(productRedirect({ host: "vantagefrc-scouting.vercel.app", pathname: "/", search: "" })).toBe("/scout");
  });

  it("serves Scouting pages, sign-in and APIs on the Scouting host", () => {
    for (const pathname of ["/scout", "/scout/teams", "/signin", "/api/me", "/api/handoff/accept", "/_next/static/x.js"]) {
      expect(productRedirect({ host: "vantagefrc-scouting.vercel.app", pathname, search: "" }), pathname).toBeNull();
    }
  });

  it("maps Vantage feature links to their Scouting twins, keeping the query", () => {
    expect(scoutingTwin("/intel")).toBe("/scout/teams");
    expect(
      productRedirect({ host: "vantagefrc-scouting.vercel.app", pathname: "/intel", search: "?orgId=o&team=254" }),
    ).toBe("/scout/teams?orgId=o&team=254");
  });

  it("sends Vantage-only pages back to Vantage", () => {
    expect(productRedirect({ host: "vantagefrc-scouting.vercel.app", pathname: "/budget", search: "?orgId=o" })).toBe(
      "https://vantagefrc.vercel.app/budget?orgId=o",
    );
  });

  it("never redirects on the Vantage host, even for /scout", () => {
    expect(productRedirect({ host: "vantagefrc.vercel.app", pathname: "/scout", search: "" })).toBeNull();
  });

  it("does not mistake /scout-coverage-live or /scouting for a /scout page", () => {
    expect(isScoutingPath("/scout-coverage-live")).toBe(false);
    expect(isScoutingPath("/scouting")).toBe(false);
    expect(isScoutingPath("/scout/entry")).toBe(true);
  });

  it("links across products through the handoff", () => {
    const href = crossProductHref("scouting", "/scout/teams", "org-1");
    expect(href.startsWith("/api/handoff/start?")).toBe(true);
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("to")).toBe("scouting");
    expect(params.get("path")).toBe("/scout/teams");
    expect(params.get("orgId")).toBe("org-1");
  });
});
