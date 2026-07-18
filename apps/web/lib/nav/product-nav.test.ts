import { describe, expect, it } from "vitest";
import {
  breadcrumbForPath, findNavMatch, PRIMARY_TABS, PRODUCT_NAV_GROUPS, withOrgHref,
} from "./product-nav";

describe("product-nav", () => {
  it("exposes hub-first pillar groups", () => {
    expect(PRODUCT_NAV_GROUPS.map((group) => group.label)).toEqual([
      "Home", "Competition", "Team", "Business", "Build", "AI", "Settings",
    ]);
  });
  it("keeps hubs in the primary island tabs", () => {
    expect(PRIMARY_TABS.map((tab) => tab.href)).toEqual([
      "/dashboard", "/competition", "/team", "/business",
    ]);
  });
  it("resolves breadcrumbs by longest live nav href", () => {
    expect(breadcrumbForPath("/competition")).toBe("Competition / Competition hub");
    expect(breadcrumbForPath("/team")).toBe("Team / Team hub");
    expect(breadcrumbForPath("/business")).toBe("Business / Business hub");
    expect(breadcrumbForPath("/build")).toBe("Build / Build hub");
    expect(breadcrumbForPath("/ai")).toBe("AI / AI hub");
    expect(breadcrumbForPath("/calendar")).toBe("Team / Season Calendar");
    expect(breadcrumbForPath("/team/admin")).toBe("Team / Admin");
    expect(breadcrumbForPath("/team/security")).toBe("Settings / Team security");
    expect(breadcrumbForPath("/intel")).toBe("Competition / Matches");
    expect(breadcrumbForPath("/logistics")).toBe("Competition / Event Logistics");
    expect(breadcrumbForPath("/robot")).toBe("Build / Robot Blueprint");
  });
  it("does not let /team hub match nested team routes", () => {
    const match = findNavMatch("/team/admin");
    expect(match?.item.href).toBe("/team/admin");
    expect(match?.group.label).toBe("Team");
  });
  it("appends orgId except on exempt chrome routes", () => {
    expect(withOrgHref("/team?tab=practice", "org-1")).toBe("/team?tab=practice&orgId=org-1");
    expect(withOrgHref("/account", "org-1")).toBe("/account");
  });
});
