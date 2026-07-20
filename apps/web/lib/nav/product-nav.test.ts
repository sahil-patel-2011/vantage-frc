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

  it("keeps Alliance desk and Season planning in the drawer", () => {
    const competition = PRODUCT_NAV_GROUPS.find((g) => g.label === "Competition")!;
    const team = PRODUCT_NAV_GROUPS.find((g) => g.label === "Team")!;
    expect(competition.items.some((i) => i.href === "/alliance-selection-desk")).toBe(true);
    expect(team.items.some((i) => i.href === "/season-planning-workspace")).toBe(true);
  });

  it("resolves breadcrumbs by longest live nav href and hub legacy paths", () => {
    expect(breadcrumbForPath("/team")).toBe("Team / Team hub");
    expect(breadcrumbForPath("/team/calendar")).toBe("Team / Calendar");
    expect(breadcrumbForPath("/calendar")).toBe("Team / Season Calendar");
    expect(breadcrumbForPath("/tasks")).toBe("Team / Build-Season Task Board");
    expect(breadcrumbForPath("/todos")).toBe("Team / Todos");
    expect(breadcrumbForPath("/command")).toBe("Competition / Command");
    expect(breadcrumbForPath("/my-day")).toBe("Competition / My Day");
    expect(breadcrumbForPath("/start")).toBe("Home / Your path");
    expect(breadcrumbForPath("/business")).toBe("Business / Business Hub");
    expect(breadcrumbForPath("/sponsorship")).toBe("Business / Sponsorship");
    expect(breadcrumbForPath("/orders")).toBe("Business / Orders");
    expect(breadcrumbForPath("/team/security")).toBe("Settings / Team security");
    expect(breadcrumbForPath("/team/ai-keys")).toBe("AI / AI API keys");
    expect(breadcrumbForPath("/team/background")).toBe("Settings / Team background");
    expect(breadcrumbForPath("/intel")).toBe("Competition / Matches & Teams");
    expect(breadcrumbForPath("/kickoff")).toBe("Build / Kickoff");
    expect(breadcrumbForPath("/logistics")).toBe("Logistics / Event Logistics");
    expect(breadcrumbForPath("/packing")).toBe("Logistics / Packing List");
    expect(breadcrumbForPath("/duties")).toBe("Logistics / Duty Roster");
    expect(breadcrumbForPath("/visit-invites")).toBe("Logistics / Visit Invites");
    expect(breadcrumbForPath("/pick-clock")).toBe("Competition / Pick clock");
    expect(breadcrumbForPath("/fmea")).toBe("Team / FMEA");
    expect(breadcrumbForPath("/batteries")).toBe("Team / Batteries");
    expect(breadcrumbForPath("/chat")).toBe("AI / Chat");
    expect(breadcrumbForPath("/strategy")).toBe("Competition / Strategy");
    expect(breadcrumbForPath("/writer")).toBe("AI / Award Writer");
    expect(breadcrumbForPath("/team/ai-memory")).toBe("AI / Memory");
    expect(breadcrumbForPath("/team/usage")).toBe("AI / AI usage");
    expect(breadcrumbForPath("/code")).toBe("Build / Code");
    expect(breadcrumbForPath("/scouting")).toBe("Competition / Scouting");
    expect(breadcrumbForPath("/scouting/forms")).toBe("Competition / Form builder");
    expect(breadcrumbForPath("/competition")).toBe("Competition / Competition hub");
    expect(breadcrumbForPath("/alliance-selection-desk")).toBe("Competition / Alliance Selection Desk");
    expect(breadcrumbForPath("/season-planning-workspace")).toBe("Team / Season Planning Workspace");
    expect(breadcrumbForPath("/media")).toBe("Media / Media hub");
  });

  it("resolves form builder via hub tab when using competition?tab=forms href", () => {
    const match = findNavMatch("/competition");
    expect(match?.group.label).toBe("Competition");
    expect(
      PRODUCT_NAV_GROUPS.find((group) => group.label === "Competition")?.items.some(
        (item) => item.href === "/competition?tab=forms",
      ),
    ).toBe(true);
    expect(
      PRODUCT_NAV_GROUPS.find((group) => group.label === "Competition")?.items.some(
        (item) => item.href === "/scouting/forms",
      ),
    ).toBe(false);
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

  it("resolves form builder and match checklist under Competition", () => {
    expect(breadcrumbForPath("/scouting/forms")).toBe("Competition / Form builder");
    expect(breadcrumbForPath("/match-checklist")).toBe("Competition / Match checklist");
    const competition = PRODUCT_NAV_GROUPS.find((g) => g.label === "Competition")!;
    expect(competition.items.some((i) => i.href === "/competition?tab=forms")).toBe(true);
    expect(competition.items.some((i) => i.href === "/competition?tab=match-checklist")).toBe(true);
    expect(competition.items.some((i) => i.href === "/competition?tab=scouting#scout-voice")).toBe(true);
    expect(competition.items.some((i) => i.href === "/competition?tab=strategy")).toBe(true);
    expect(competition.items.some((i) => i.href === "/competition?tab=scouting")).toBe(true);
  });

  it("keeps Business hub tabs and workbenches in the drawer", () => {
    const business = PRODUCT_NAV_GROUPS.find((g) => g.label === "Business")!;
    expect(business.items.some((i) => i.href === "/business?tab=sponsors")).toBe(true);
    expect(business.items.some((i) => i.href === "/business?tab=grants")).toBe(true);
    expect(business.items.some((i) => i.href === "/team/grants")).toBe(true);
    expect(business.items.some((i) => i.href === "/team/sponsors")).toBe(false);
    expect(business.items.some((i) => i.href === "/media")).toBe(false);
  });

  it("keeps Media hub and kit in the Media drawer group", () => {
    const media = PRODUCT_NAV_GROUPS.find((g) => g.label === "Media")!;
    expect(media.items.some((i) => i.href === "/media")).toBe(true);
    expect(media.items.some((i) => i.href === "/media-kit")).toBe(true);
    expect(media.items.some((i) => i.href === "/outreach-calendar")).toBe(true);
    expect(media.items.some((i) => i.href === "/media?tab=drafts")).toBe(true);
    expect(breadcrumbForPath("/media-kit")).toBe("Media / Media Kit editor");
    expect(breadcrumbForPath("/outreach-calendar")).toBe("Media / Outreach Calendar editor");
  });

  it("marks unfinished destinations as planned instead of dead links", () => {
    const planned = PRODUCT_NAV_GROUPS.flatMap((group) =>
      group.items.filter((item) => item.state === "planned").map((item) => item.href),
    );
    expect(planned).not.toContain("/repairs");
    expect(planned).not.toContain("/knowledge");
  });

  it("dedupes cross-pillar laundry-list links", () => {
    const hrefs = PRODUCT_NAV_GROUPS.flatMap((group) =>
      group.items.filter((item) => item.state !== "planned").map((item) => `${group.label}:${item.href}`),
    );
    expect(hrefs.filter((entry) => entry.endsWith(":/intel"))).toHaveLength(1);
    expect(hrefs.filter((entry) => entry.includes(":/ai?tab=chat") || entry.endsWith(":/chat"))).toHaveLength(1);
    expect(hrefs.filter((entry) => entry.endsWith(":/calendar"))).toHaveLength(1);
    expect(hrefs.filter((entry) => entry.includes(":/build?tab=cad") || entry.endsWith(":/cad"))).toHaveLength(1);
    expect(hrefs.filter((entry) => entry.endsWith(":/team")).length).toBeGreaterThanOrEqual(1);
  });

  it("keeps Strategy under Competition and Kickoff under Build", () => {
    const competition = PRODUCT_NAV_GROUPS.find((g) => g.label === "Competition")!;
    const build = PRODUCT_NAV_GROUPS.find((g) => g.label === "Build")!;
    expect(competition.items.some((i) => i.href === "/competition?tab=strategy")).toBe(true);
    expect(competition.items.some((i) => i.href === "/kickoff")).toBe(false);
    expect(build.items.some((i) => i.href === "/build?tab=kickoff")).toBe(true);
  });
});
