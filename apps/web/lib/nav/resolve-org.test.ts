import { describe, expect, it } from "vitest";
import { expandLegacyRedirects } from "./legacy-redirects";
import { readOrgIdFromSearch, withPersistedOrgSearch } from "./resolve-org";

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
});
