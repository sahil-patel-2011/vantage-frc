import { describe, expect, it } from "vitest";
import {
  breadcrumbForPath,
  cmdkNavCatalog,
  FEATURED_SOFT_UI_LINKS,
  findNavMatch,
  MORE_SHEET_LINKS,
  PILLAR_SHEET_LINKS,
  PRIMARY_TABS,
  PRODUCT_NAV_GROUPS,
  withOrgHref,
  withSelectedOrgHref,
} from "./product-nav";

describe("product-nav", () => {
  it("exposes the four product workspaces", () => {
    expect(PRODUCT_NAV_GROUPS.map((group) => group.label)).toEqual([
      "Scout",
      "Compete",
      "Build",
      "Run season",
    ]);
  });

  it("keeps the four workspaces in the primary island tabs", () => {
    expect(PRIMARY_TABS.map((tab) => tab.href)).toEqual([
      "/competition?tab=scouting",
      "/competition",
      "/build",
      "/team",
    ]);
  });

  it("keeps workspace and glanceable shortcuts for Search", () => {
    expect(PILLAR_SHEET_LINKS.map((link) => link.label)).toEqual([
      "Scout",
      "Compete",
      "Build",
      "Run season",
    ]);
    expect(PILLAR_SHEET_LINKS.find((l) => l.label === "Scout")?.icon).toBe("scout");
    expect(MORE_SHEET_LINKS.map((link) => link.label)).toEqual([
      "My Day",
      "Forms",
      "Checklist",
      "Team chat",
    ]);
  });

  it("features Alliance desk, Season planning, and AI keys for Cmd+K residual list", () => {
    expect(FEATURED_SOFT_UI_LINKS.map((link) => link.href)).toEqual([
      "/alliance-selection-desk",
      "/season-planning-workspace",
      "/team/ai-keys",
      "/writer",
    ]);
  });

  it("keeps one drawer link per workspace", () => {
    for (const group of PRODUCT_NAV_GROUPS) {
      const live = group.items.filter((i) => i.state !== "planned");
      expect(live.length).toBe(1);
    }
    expect(PRODUCT_NAV_GROUPS.find((g) => g.label === "Compete")?.items[0]?.href).toBe(
      "/competition",
    );
    expect(PRODUCT_NAV_GROUPS.find((g) => g.label === "Scout")?.items[0]?.href).toBe(
      "/competition?tab=scouting",
    );
  });

  it("puts deep tools in Cmd+K, except the Scout workspace entry", () => {
    const catalog = cmdkNavCatalog();
    expect(catalog.some((i) => i.href === "/competition?tab=scouting")).toBe(true);
    expect(catalog.some((i) => i.href === "/competition?tab=strategy")).toBe(true);
    expect(catalog.some((i) => i.href === "/alliance-selection-desk")).toBe(true);
    expect(catalog.some((i) => i.href === "/season-planning-workspace")).toBe(true);
    expect(catalog.some((i) => i.href === "/packing")).toBe(true);
    expect(catalog.some((i) => i.href === "/docs")).toBe(true);
    expect(
      PRODUCT_NAV_GROUPS.find((g) => g.label === "Scout")?.items.some(
        (i) => i.href === "/competition?tab=scouting",
      ),
    ).toBe(true);
  });

  it("resolves breadcrumbs by hub roots and PRODUCT_HUBS legacy paths", () => {
    expect(breadcrumbForPath("/team")).toBe("Run season");
    expect(breadcrumbForPath("/team/calendar")).toBe("Run season / Calendar");
    expect(breadcrumbForPath("/todos")).toBe("Run season / Work");
    expect(breadcrumbForPath("/command")).toBe("Compete / Event day");
    expect(breadcrumbForPath("/my-day")).toBe("Compete / My Day");
    expect(breadcrumbForPath("/business")).toBe("Run season");
    expect(breadcrumbForPath("/sponsorship")).toBe("Run season / Packages");
    expect(breadcrumbForPath("/orders")).toBe("Run season / Orders");
    expect(breadcrumbForPath("/team/ai-keys")).toBe("Run season / API keys");
    expect(breadcrumbForPath("/kickoff")).toBe("Build / Kickoff");
    expect(breadcrumbForPath("/logistics")).toBe("Run season / Logistics");
    expect(breadcrumbForPath("/packing")).toBe("Run season / Packing");
    expect(breadcrumbForPath("/duties")).toBe("Run season / Duties");
    expect(breadcrumbForPath("/visit-invites")).toBe("Run season / Visit invites");
    expect(breadcrumbForPath("/strategy")).toBe("Compete / Strategy");
    expect(breadcrumbForPath("/scouting")).toBe("Scout / Scouting");
    expect(breadcrumbForPath("/scouting/forms")).toBe("Scout / Forms");
    expect(breadcrumbForPath("/competition")).toBe("Compete");
    expect(breadcrumbForPath("/alliance-selection-desk")).toBe("Compete / Alliance desk");
    expect(breadcrumbForPath("/season-planning-workspace")).toBe("Run season / Season plan");
    expect(breadcrumbForPath("/media")).toBe("Run season");
    expect(breadcrumbForPath("/media-kit")).toBe("Run season / Kit");
    expect(breadcrumbForPath("/chat")).toBe("Run season / Ask");
  });

  it("resolves hub tabs via PRODUCT_HUBS when not in the flat drawer", () => {
    const match = findNavMatch("/competition");
    expect(match?.group.label).toBe("Compete");
    expect(
      PRODUCT_NAV_GROUPS.find((group) => group.label === "Scout")?.items.some(
        (item) => item.href === "/competition?tab=forms",
      ),
    ).toBe(false);
    expect(findNavMatch("/scouting/forms")?.item.label).toBe("Forms");
    expect(findNavMatch("/match-checklist")?.item.label).toBe("Pit");
  });

  it("resolves nested team knowledge via hub legacy href", () => {
    const match = findNavMatch("/team/knowledge");
    expect(match?.item.href).toBe("/team?tab=knowledge");
    expect(match?.group.label).toBe("Run season");
  });

  it("prefers Run season over Settings for bare /team", () => {
    const match = findNavMatch("/team");
    expect(match?.group.label).toBe("Run season");
    expect(match?.item.label).toBe("Run season");
  });

  it("appends orgId except on exempt chrome routes", () => {
    expect(withOrgHref("/practice", "org-1")).toBe("/practice?orgId=org-1");
    expect(withOrgHref("/practice?tab=a", "org-1")).toBe("/practice?tab=a&orgId=org-1");
    expect(withOrgHref("/account", "org-1")).toBe("/account");
    expect(withOrgHref("/practice?orgId=org-1", "org-2")).toBe("/practice?orgId=org-1");
    expect(withOrgHref("/competition?tab=scouting#scout-voice", "org-1")).toBe(
      "/competition?tab=scouting&orgId=org-1#scout-voice",
    );
    expect(withSelectedOrgHref("/business?tab=orders&orgId=old", "org-2")).toBe(
      "/business?tab=orders&orgId=org-2",
    );
  });

  it("keeps Strategy under Competition and Kickoff under Build via Cmd+K/hubs", () => {
    const catalog = cmdkNavCatalog();
    expect(catalog.some((i) => i.href === "/competition?tab=strategy")).toBe(true);
    expect(catalog.some((i) => i.href === "/build?tab=kickoff")).toBe(true);
    expect(PRODUCT_NAV_GROUPS.find((g) => g.label === "Compete")?.items[0]?.href).toBe(
      "/competition",
    );
    expect(PRODUCT_NAV_GROUPS.find((g) => g.label === "Build")?.items[0]?.href).toBe("/build");
  });
});
