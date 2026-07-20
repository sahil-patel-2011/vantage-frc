import { describe, expect, it } from "vitest";
import {
  breadcrumbForPath,
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
  it("exposes the consolidated pillar groups", () => {
    expect(PRODUCT_NAV_GROUPS.map((group) => group.label)).toEqual([
      "Home",
      "Competition",
      "Team",
      "Logistics",
      "Business",
      "Media",
      "Build",
      "AI",
      "Settings",
    ]);
  });

  it("keeps Soft-UI hubs in the primary island tabs", () => {
    expect(PRIMARY_TABS.map((tab) => tab.href)).toEqual([
      "/dashboard",
      "/competition",
      "/team",
      "/business",
    ]);
  });

  it("separates pillar shortcuts from glanceable tools in the More sheet", () => {
    expect(PILLAR_SHEET_LINKS.map((link) => link.label)).toEqual([
      "Competition",
      "Team",
      "Logistics",
      "Business",
      "Media",
      "Build",
      "AI",
    ]);
    expect(PILLAR_SHEET_LINKS.find((l) => l.label === "Media")?.icon).toBe("camera");
    expect(MORE_SHEET_LINKS.map((link) => link.label)).toEqual([
      "My Day",
      "Forms",
      "Checklist",
      "Messages",
    ]);
  });

  it("features Alliance desk, Season planning, and AI keys in More Soft-UI", () => {
    expect(FEATURED_SOFT_UI_LINKS.map((link) => link.href)).toEqual([
      "/alliance-selection-desk",
      "/season-planning-workspace",
      "/team/ai-keys",
      "/writer",
    ]);
  });

  it("keeps short drawer lists (≈3–6 items) with Alliance desk and Season planning", () => {
    for (const group of PRODUCT_NAV_GROUPS) {
      const live = group.items.filter((i) => i.state !== "planned");
      expect(live.length).toBeGreaterThanOrEqual(3);
      expect(live.length).toBeLessThanOrEqual(6);
    }
    const competition = PRODUCT_NAV_GROUPS.find((g) => g.label === "Competition")!;
    const team = PRODUCT_NAV_GROUPS.find((g) => g.label === "Team")!;
    expect(competition.items.some((i) => i.href === "/alliance-selection-desk")).toBe(true);
    expect(team.items.some((i) => i.href === "/season-planning-workspace")).toBe(true);
  });

  it("resolves breadcrumbs by longest live nav href and hub legacy paths", () => {
    expect(breadcrumbForPath("/team")).toBe("Team / Team hub");
    expect(breadcrumbForPath("/team/calendar")).toBe("Team / Calendar");
    expect(breadcrumbForPath("/todos")).toBe("Team / Todos");
    expect(breadcrumbForPath("/command")).toBe("Competition / Command");
    expect(breadcrumbForPath("/my-day")).toBe("Competition / My Day");
    expect(breadcrumbForPath("/business")).toBe("Business / Business hub");
    expect(breadcrumbForPath("/sponsorship")).toBe("Business / Sponsorship");
    expect(breadcrumbForPath("/orders")).toBe("Business / Orders");
    expect(breadcrumbForPath("/team/ai-keys")).toBe("AI / API keys");
    expect(breadcrumbForPath("/kickoff")).toBe("Build / Kickoff");
    expect(breadcrumbForPath("/logistics")).toBe("Logistics / Logistics");
    expect(breadcrumbForPath("/packing")).toBe("Logistics / Packing");
    expect(breadcrumbForPath("/duties")).toBe("Logistics / Duties");
    expect(breadcrumbForPath("/visit-invites")).toBe("Logistics / Visit invites");
    expect(breadcrumbForPath("/strategy")).toBe("Competition / Strategy");
    expect(breadcrumbForPath("/scouting")).toBe("Competition / Scouting");
    expect(breadcrumbForPath("/scouting/forms")).toBe("Competition / Form builder");
    expect(breadcrumbForPath("/competition")).toBe("Competition / Competition hub");
    expect(breadcrumbForPath("/alliance-selection-desk")).toBe("Competition / Alliance desk");
    expect(breadcrumbForPath("/season-planning-workspace")).toBe("Team / Season planning");
    expect(breadcrumbForPath("/media")).toBe("Media / Media hub");
    expect(breadcrumbForPath("/media-kit")).toBe("Media / Kit");
    expect(breadcrumbForPath("/chat")).toBe("AI / Chat");
  });

  it("resolves hub tabs via PRODUCT_HUBS when not in the short drawer", () => {
    const match = findNavMatch("/competition");
    expect(match?.group.label).toBe("Competition");
    expect(
      PRODUCT_NAV_GROUPS.find((group) => group.label === "Competition")?.items.some(
        (item) => item.href === "/competition?tab=forms",
      ),
    ).toBe(false);
    expect(findNavMatch("/scouting/forms")?.item.label).toBe("Form builder");
    expect(findNavMatch("/match-checklist")?.item.label).toBe("Match checklist");
  });

  it("resolves nested team knowledge via hub legacy href", () => {
    const match = findNavMatch("/team/knowledge");
    expect(match?.item.href).toBe("/team?tab=knowledge");
    expect(match?.group.label).toBe("Team");
  });

  it("prefers Team hub over Settings for bare /team", () => {
    const match = findNavMatch("/team");
    expect(match?.group.label).toBe("Team");
    expect(match?.item.label).toBe("Team hub");
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

  it("keeps core Competition / Business / Media drawer destinations", () => {
    const competition = PRODUCT_NAV_GROUPS.find((g) => g.label === "Competition")!;
    const business = PRODUCT_NAV_GROUPS.find((g) => g.label === "Business")!;
    const media = PRODUCT_NAV_GROUPS.find((g) => g.label === "Media")!;
    expect(competition.items.some((i) => i.href === "/competition?tab=strategy")).toBe(true);
    expect(competition.items.some((i) => i.href === "/competition?tab=scouting")).toBe(true);
    expect(business.items.some((i) => i.href === "/business?tab=sponsors")).toBe(true);
    expect(business.items.some((i) => i.href === "/business?tab=grants")).toBe(true);
    expect(media.items.some((i) => i.href === "/media")).toBe(true);
    expect(media.items.some((i) => i.href === "/media?tab=kit")).toBe(true);
    expect(media.items.some((i) => i.href === "/media?tab=drafts")).toBe(true);
  });

  it("marks unfinished destinations as planned instead of dead links", () => {
    const planned = PRODUCT_NAV_GROUPS.flatMap((group) =>
      group.items.filter((item) => item.state === "planned").map((item) => item.href),
    );
    expect(planned).not.toContain("/repairs");
    expect(planned).not.toContain("/knowledge");
  });

  it("keeps Strategy under Competition and Kickoff under Build", () => {
    const competition = PRODUCT_NAV_GROUPS.find((g) => g.label === "Competition")!;
    const build = PRODUCT_NAV_GROUPS.find((g) => g.label === "Build")!;
    expect(competition.items.some((i) => i.href === "/competition?tab=strategy")).toBe(true);
    expect(competition.items.some((i) => i.href === "/kickoff")).toBe(false);
    expect(build.items.some((i) => i.href === "/build?tab=kickoff")).toBe(true);
  });
});
