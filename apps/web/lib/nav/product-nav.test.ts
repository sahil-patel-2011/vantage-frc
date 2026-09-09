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
  it("exposes flat pillar groups (no Settings accordion)", () => {
    // Media is a tool set under Business › Outreach; AI is the "Ask AI" control.
    // Neither is a place you go, so neither is a row in the panel.
    expect(PRODUCT_NAV_GROUPS.map((group) => group.label)).toEqual([
      "Home",
      "Competition",
      "Team",
      "Logistics",
      "Business",
      "Build",
    ]);
  });

  it("keeps Soft-UI hubs in the primary island tabs", () => {
    expect(PRIMARY_TABS.map((tab) => tab.href)).toEqual([
      "/dashboard",
      "/competition",
      "/team",
      "/build",
    ]);
  });

  it("keeps pillar and glanceable shortcuts for Search", () => {
    expect(PILLAR_SHEET_LINKS.map((link) => link.label)).toEqual([
      "Competition",
      "Team",
      "Logistics",
      "Business",
      "Build",
      "Ask AI",
    ]);
    expect(PILLAR_SHEET_LINKS.find((l) => l.label === "Ask AI")?.href).toBe("/ai?tab=chat");
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

  it("keeps one drawer link per pillar (hub root only)", () => {
    for (const group of PRODUCT_NAV_GROUPS) {
      const live = group.items.filter((i) => i.state !== "planned");
      expect(live.length).toBe(1);
      expect(live[0]?.href.includes("?tab=")).toBe(false);
    }
    expect(PRODUCT_NAV_GROUPS.find((g) => g.label === "Competition")?.items[0]?.href).toBe(
      "/competition",
    );
    expect(PRODUCT_NAV_GROUPS.find((g) => g.label === "Team")?.items[0]?.href).toBe("/team");
  });

  it("puts deep tools in Cmd+K catalog, not the drawer", () => {
    const catalog = cmdkNavCatalog();
    expect(catalog.some((i) => i.href === "/competition?tab=scouting")).toBe(true);
    expect(catalog.some((i) => i.href === "/competition?tab=strategy")).toBe(true);
    expect(catalog.some((i) => i.href === "/alliance-selection-desk")).toBe(true);
    expect(catalog.some((i) => i.href === "/season-planning-workspace")).toBe(true);
    expect(catalog.some((i) => i.href === "/packing")).toBe(true);
    expect(catalog.some((i) => i.href === "/docs")).toBe(true);
    expect(
      PRODUCT_NAV_GROUPS.find((g) => g.label === "Competition")?.items.some(
        (i) => i.href === "/competition?tab=scouting",
      ),
    ).toBe(false);
  });

  it("resolves breadcrumbs by hub roots and PRODUCT_HUBS legacy paths", () => {
    expect(breadcrumbForPath("/team")).toBe("Team");
    expect(breadcrumbForPath("/team/calendar")).toBe("Team / Calendar");
    expect(breadcrumbForPath("/todos")).toBe("Team / Work");
    expect(breadcrumbForPath("/command")).toBe("Competition / Event day");
    expect(breadcrumbForPath("/my-day")).toBe("Competition / My Day");
    expect(breadcrumbForPath("/business")).toBe("Business");
    expect(breadcrumbForPath("/sponsorship")).toBe("Business / Packages");
    expect(breadcrumbForPath("/orders")).toBe("Business / Orders");
    expect(breadcrumbForPath("/team/ai-keys")).toBe("AI / API keys");
    expect(breadcrumbForPath("/kickoff")).toBe("Build / Kickoff");
    expect(breadcrumbForPath("/logistics")).toBe("Logistics");
    expect(breadcrumbForPath("/packing")).toBe("Logistics / Packing");
    expect(breadcrumbForPath("/duties")).toBe("Logistics / Duties");
    expect(breadcrumbForPath("/visit-invites")).toBe("Logistics / Visit invites");
    expect(breadcrumbForPath("/strategy")).toBe("Competition / Strategy");
    expect(breadcrumbForPath("/scouting")).toBe("Competition / Scouting");
    expect(breadcrumbForPath("/scouting/forms")).toBe("Competition / Forms");
    expect(breadcrumbForPath("/competition")).toBe("Competition");
    expect(breadcrumbForPath("/alliance-selection-desk")).toBe("Competition / Alliance desk");
    expect(breadcrumbForPath("/season-planning-workspace")).toBe("Team / Season plan");
    expect(breadcrumbForPath("/media")).toBe("Media");
    expect(breadcrumbForPath("/media-kit")).toBe("Media / Kit");
    expect(breadcrumbForPath("/chat")).toBe("AI / Chat");
  });

  it("resolves hub tabs via PRODUCT_HUBS when not in the flat drawer", () => {
    const match = findNavMatch("/competition");
    expect(match?.group.label).toBe("Competition");
    expect(
      PRODUCT_NAV_GROUPS.find((group) => group.label === "Competition")?.items.some(
        (item) => item.href === "/competition?tab=forms",
      ),
    ).toBe(false);
    expect(findNavMatch("/scouting/forms")?.item.label).toBe("Forms");
    expect(findNavMatch("/match-checklist")?.item.label).toBe("Pit");
  });

  it("resolves nested team knowledge via hub legacy href", () => {
    const match = findNavMatch("/team/knowledge");
    expect(match?.item.href).toBe("/team?tab=knowledge");
    expect(match?.group.label).toBe("Team");
  });

  it("prefers Team hub over Settings for bare /team", () => {
    const match = findNavMatch("/team");
    expect(match?.group.label).toBe("Team");
    expect(match?.item.label).toBe("Team");
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
    expect(PRODUCT_NAV_GROUPS.find((g) => g.label === "Competition")?.items[0]?.href).toBe(
      "/competition",
    );
    expect(PRODUCT_NAV_GROUPS.find((g) => g.label === "Build")?.items[0]?.href).toBe("/build");
  });
});
