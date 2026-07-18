import { describe, expect, it } from "vitest";
import {
  breadcrumbForPath,
  findNavMatch,
  PRIMARY_TABS,
  PRODUCT_NAV_GROUPS,
  withOrgHref,
} from "./product-nav";

describe("product-nav", () => {
  it("exposes the pillar groups teams expect", () => {
    expect(PRODUCT_NAV_GROUPS.map((group) => group.label)).toEqual([
      "Home",
      "Competition",
      "Scouting",
      "Calendar",
      "Build",
      "Team",
      "Logistics",
      "Kickoff",
      "Business",
      "Settings",
    ]);
  });

  it("keeps Calendar in the primary island tabs", () => {
    expect(PRIMARY_TABS.some((tab) => tab.href === "/team/calendar")).toBe(true);
  });

  it("resolves breadcrumbs by longest live nav href", () => {
    expect(breadcrumbForPath("/team/calendar")).toBe("Calendar / Team Calendar");
    expect(breadcrumbForPath("/calendar")).toBe("Calendar / Season Calendar");
    expect(breadcrumbForPath("/shifts")).toBe("Calendar / Shifts");
    expect(breadcrumbForPath("/todos")).toBe("Team / Todos");
    expect(breadcrumbForPath("/tasks")).toBe("Team / Task board");
    expect(breadcrumbForPath("/command")).toBe("Competition / Event Day");
    expect(breadcrumbForPath("/business")).toBe("Business / Business Hub");
    expect(breadcrumbForPath("/team/security")).toBe("Settings / Team security");
    expect(breadcrumbForPath("/intel")).toBe("Competition / Matches");
    expect(breadcrumbForPath("/kickoff")).toBe("Kickoff / Kickoff Summary");
    expect(breadcrumbForPath("/logistics")).toBe("Logistics / Event Logistics");
    expect(breadcrumbForPath("/packing")).toBe("Logistics / Packing List");
    expect(breadcrumbForPath("/duties")).toBe("Logistics / Duty Roster");
    expect(breadcrumbForPath("/pick-clock")).toBe("Scouting / Pick Clock");
    expect(breadcrumbForPath("/fmea")).toBe("Build / Failure Log (FMEA)");
  });

  it("does not let /team match nested team routes", () => {
    const match = findNavMatch("/team/knowledge");
    expect(match?.item.href).toBe("/team/knowledge");
    expect(match?.group.label).toBe("Team");
  });

  it("appends orgId except on exempt chrome routes", () => {
    expect(withOrgHref("/practice", "org-1")).toBe("/practice?orgId=org-1");
    expect(withOrgHref("/practice?tab=a", "org-1")).toBe("/practice?tab=a&orgId=org-1");
    expect(withOrgHref("/account", "org-1")).toBe("/account");
    expect(withOrgHref("/practice?orgId=org-1", "org-2")).toBe("/practice?orgId=org-1");
  });

  it("marks unfinished destinations as planned instead of dead links", () => {
    const planned = PRODUCT_NAV_GROUPS.flatMap((group) =>
      group.items.filter((item) => item.state === "planned").map((item) => item.href),
    );
    expect(planned).toContain("/travel");
    expect(planned).toContain("/parts-relay");
    expect(planned).not.toContain("/repairs");
    expect(planned).not.toContain("/knowledge");
  });
});
