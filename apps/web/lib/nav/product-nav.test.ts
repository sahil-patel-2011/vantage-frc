import { describe, expect, it } from "vitest";
import {
  breadcrumbForPath,
  findNavMatch,
  MORE_SHEET_LINKS,
  PRIMARY_TABS,
  PRODUCT_NAV_GROUPS,
  withOrgHref,
} from "./product-nav";

describe("product-nav", () => {
  it("exposes the consolidated pillar groups", () => {
    expect(PRODUCT_NAV_GROUPS.map((group) => group.label)).toEqual([
      "Home",
      "Competition",
      "Team",
      "Logistics",
      "Business",
      "Build",
      "AI",
      "Settings",
    ]);
  });

  it("keeps Team calendar in the primary island tabs", () => {
    expect(PRIMARY_TABS.some((tab) => tab.href === "/team/calendar")).toBe(true);
  });

  it("surfaces pillar shortcuts in the More sheet", () => {
    expect(MORE_SHEET_LINKS.map((link) => link.label)).toEqual([
      "My Day",
      "Messages",
      "Logistics",
      "Business",
      "Build",
      "AI",
    ]);
  });

  it("resolves breadcrumbs by longest live nav href", () => {
    expect(breadcrumbForPath("/team/calendar")).toBe("Team / Team Calendar");
    expect(breadcrumbForPath("/calendar")).toBe("Team / Season Calendar");
    expect(breadcrumbForPath("/shifts")).toBe("Team / Shifts");
    expect(breadcrumbForPath("/tasks")).toBe("Team / Todos");
    expect(breadcrumbForPath("/command")).toBe("Competition / Event Day");
    expect(breadcrumbForPath("/my-day")).toBe("Competition / My Day");
    expect(breadcrumbForPath("/business")).toBe("Business / Business Hub");
    expect(breadcrumbForPath("/sponsorship")).toBe("Business / Sponsorship One-Pagers");
    expect(breadcrumbForPath("/orders")).toBe("Business / Orders");
    expect(breadcrumbForPath("/team/security")).toBe("Settings / Team security");
    expect(breadcrumbForPath("/team/background")).toBe("Settings / Team background");
    expect(breadcrumbForPath("/intel")).toBe("Competition / Matches & Teams");
    expect(breadcrumbForPath("/kickoff")).toBe("Competition / Kickoff");
    expect(breadcrumbForPath("/logistics")).toBe("Logistics / Event Logistics");
    expect(breadcrumbForPath("/packing")).toBe("Logistics / Packing List");
    expect(breadcrumbForPath("/duties")).toBe("Logistics / Duty Roster");
    expect(breadcrumbForPath("/visit-invites")).toBe("Logistics / Visit Invites");
    expect(breadcrumbForPath("/pick-clock")).toBe("Competition / Pick Clock");
    expect(breadcrumbForPath("/fmea")).toBe("Build / Failure Log (FMEA)");
    expect(breadcrumbForPath("/chat")).toBe("AI / Vantage AI");
    expect(breadcrumbForPath("/strategy")).toBe("AI / Strategy & AI");
    expect(breadcrumbForPath("/writer")).toBe("AI / Award Writer");
    expect(breadcrumbForPath("/team/usage")).toBe("AI / AI usage");
    expect(breadcrumbForPath("/scouting")).toBe("Competition / Scouting");
  });

  it("does not let /team match nested team routes", () => {
    const match = findNavMatch("/team/knowledge");
    expect(match?.item.href).toBe("/team/knowledge");
    expect(match?.group.label).toBe("Team");
  });

  it("prefers Team Admin over Settings for bare /team", () => {
    const match = findNavMatch("/team");
    expect(match?.group.label).toBe("Team");
    expect(match?.item.label).toBe("Admin");
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
    expect(planned).toContain("/parts-relay");
    expect(planned).not.toContain("/repairs");
    expect(planned).not.toContain("/knowledge");
  });

  it("dedupes cross-pillar laundry-list links", () => {
    const hrefs = PRODUCT_NAV_GROUPS.flatMap((group) =>
      group.items.filter((item) => item.state !== "planned").map((item) => `${group.label}:${item.href}`),
    );
    expect(hrefs.filter((entry) => entry.endsWith(":/intel"))).toHaveLength(1);
    expect(hrefs.filter((entry) => entry.endsWith(":/chat"))).toHaveLength(1);
    expect(hrefs.filter((entry) => entry.endsWith(":/calendar"))).toHaveLength(1);
    expect(hrefs.filter((entry) => entry.endsWith(":/cad"))).toHaveLength(1);
    expect(hrefs.filter((entry) => entry.endsWith(":/team")).length).toBeGreaterThanOrEqual(1);
  });
});
