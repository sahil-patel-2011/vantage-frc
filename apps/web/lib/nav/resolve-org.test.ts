import { describe, expect, it } from "vitest";
import { expandLegacyRedirects } from "./legacy-redirects";
import { FEATURE_API_TIMEOUT_MS, readOrgIdFromSearch, withPersistedOrgSearch } from "./resolve-org";

describe("FEATURE_API_TIMEOUT_MS", () => {
  it("stays under the Playwright hub-ready wait so a dead database cannot hang the shell", () => {
    expect(FEATURE_API_TIMEOUT_MS).toBeGreaterThan(0);
    expect(FEATURE_API_TIMEOUT_MS).toBeLessThanOrEqual(8_000);
  });
});

describe("readOrgIdFromSearch", () => {
  it("reads orgId from a query string", () => {
    expect(readOrgIdFromSearch("?tab=scouting&orgId=org-1")).toBe("org-1");
    expect(readOrgIdFromSearch("orgId=org-1")).toBe("org-1");
  });

  it("returns null when missing or blank", () => {
    expect(readOrgIdFromSearch("?tab=scouting")).toBeNull();
    expect(readOrgIdFromSearch("?orgId=")).toBeNull();
    expect(readOrgIdFromSearch("")).toBeNull();
  });
});

describe("withPersistedOrgSearch", () => {
  it("adds orgId without dropping the active tab", () => {
    expect(withPersistedOrgSearch("?tab=strategy", "org-1")).toBe("?tab=strategy&orgId=org-1");
  });

  it("is a no-op when the same org is already present", () => {
    expect(withPersistedOrgSearch("?tab=command&orgId=org-1", "org-1")).toBe("?tab=command&orgId=org-1");
  });
});

describe("expandLegacyRedirects", () => {
  it("forwards orgId when the hub destination already has ?tab=", () => {
    const rows = expandLegacyRedirects([{ source: "/scouting", destination: "/competition?tab=scouting" }]);
    expect(rows[0]).toMatchObject({
      source: "/scouting",
      destination: "/competition?tab=scouting&orgId=:orgId",
    });
    expect(rows[0]?.has?.[0]).toEqual({ type: "query", key: "orgId", value: "(?<orgId>[^&]+)" });
    expect(rows[1]).toEqual({
      source: "/scouting",
      destination: "/competition?tab=scouting",
      permanent: false,
    });
  });

  it("leaves query-less destinations as a single redirect", () => {
    const rows = expandLegacyRedirects([{ source: "/help", destination: "/docs" }]);
    expect(rows).toEqual([{ source: "/help", destination: "/docs", permanent: false }]);
  });

  /**
   * Sixteen places in the app link to "/strategy?tab=picks". The destination
   * spends `tab` on the hub tab, so the inbound value was dropped and every
   * one of those links opened the matchup view instead of the pick desk.
   */
  it("re-emits a sub-tab that the destination's own ?tab= would have eaten", () => {
    const rows = expandLegacyRedirects([
      { source: "/strategy", destination: "/competition?tab=strategy", subTabs: ["picks"] },
    ]);

    // Narrowest first, or Next matches a catch-all and drops the sub-tab again.
    expect(rows[0]).toMatchObject({
      source: "/strategy",
      destination: "/competition?tab=strategy&sub=picks&orgId=:orgId",
    });
    expect(rows[0]?.has).toEqual([
      { type: "query", key: "tab", value: "picks" },
      { type: "query", key: "orgId", value: "(?<orgId>[^&]+)" },
    ]);

    // `has` is an AND, so a link without an org needs its own rule.
    expect(rows[1]).toMatchObject({ destination: "/competition?tab=strategy&sub=picks" });
    expect(rows[1]?.has).toEqual([{ type: "query", key: "tab", value: "picks" }]);

    // The plain orgId and bare fallbacks still follow.
    expect(rows[2]).toMatchObject({ destination: "/competition?tab=strategy&orgId=:orgId" });
    expect(rows[3]).toMatchObject({ destination: "/competition?tab=strategy" });
    expect(rows).toHaveLength(4);
  });

  it("keeps the real /strategy entry wired to the pick desk", () => {
    const strategy = expandLegacyRedirects().filter((row) => row.source === "/strategy");
    expect(strategy[0]?.destination).toContain("sub=picks");
  });
});
