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

  it("keeps Soft-UI hubs in the primary island tabs", () => {
    expect(PRIMARY_TABS.map((tab) => tab.href)).toEqual([
      "/dashboard",
      "/competition",
      "/team",
      "/business",
    ]);
  });

  it("surfaces pillar shortcuts in the More sheet", () => {
    expect(MORE_SHEET_LINKS.map((link) => link.label)).toEqual([
      "My Day",
      "Messages",
      "Knowledge",
      "Logistics",
      "Build",
      "AI",
    ]);
  });

  it("resolves breadcrumbs by longest live nav href and hub legacy paths", () => {
    expect(breadcrumbForPath("/team")).toBe("Team / Team hub");
    expect(breadcrumbForPath("/team/calendar")).toBe("Team / Calendar");
    expect(breadcrumbForPath("/calendar")).toBe("Team / Season Calendar");
    expect(breadcrumbForPath("/shifts")).toBe("Team / Shifts");
    expect(breadcrumbForPath("/tasks")).toBe("Team / Todos");
    expect(breadcrumbForPath("/command")).toBe("Competition / Command");
    expect(breadcrumbForPath("/my-day")).toBe("Competition / My Day");
    expect(breadcrumbForPath("/start")).toBe("Home / Your path");
    expect(breadcrumbForPath("/business")).toBe("Business / Business Hub");
    expect(breadcrumbForPath("/sponsorship")).toBe("Business / Sponsorship");
    expect(breadcrumbForPath("/orders")).toBe("Business / Orders");
    expect(breadcrumbForPath("/team/security")).toBe("Settings / Team security");
    expect(breadcrumbForPath("/team/background")).toBe("Settings / Team background");
    expect(breadcrumbForPath("/intel")).toBe("Competition / Matches & Teams");
    expect(breadcrumbForPath("/kickoff")).toBe("Build / Kickoff");
    expect(breadcrumbForPath("/logistics")).toBe("Logistics / Event Logistics");
    expect(breadcrumbForPath("/packing")).toBe("Logistics / Packing List");
    expect(breadcrumbForPath("/duties")).toBe("Logistics / Duty Roster");
    expect(breadcrumbForPath("/visit-invites")).toBe("Logistics / Visit Invites");
    expect(breadcrumbForPath("/pick-clock")).toBe("Competition / Pick clock");
    expect(breadcrumbForPath("/fmea")).toBe("Build / FMEA");
    expect(breadcrumbForPath("/chat")).toBe("AI / Chat");
    expect(breadcrumbForPath("/strategy")).toBe("Competition / Strategy");
    expect(breadcrumbForPath("/writer")).toBe("AI / Award Writer");
    expect(breadcrumbForPath("/team/usage")).toBe("AI / AI usage");
    expect(breadcrumbForPath("/scouting")).toBe("Competition / Scouting");
    expect(breadcrumbForPath("/scouting/forms")).toBe("Competition / Form builder");
    expect(breadcrumbForPath("/competition")).toBe("Competition / Competition hub");
  });

  it("resolves form builder via hub tab when using competition?tab=forms href", () => {
    const match = findNavMatch("/competition");
    expect(match?.group.label).toBe("Competition");
    expect(
      PRODUCT_NAV_GROUPS.find((group) => group.label === "Competition")?.items.some(
        (item) => item.href === "/competition?tab=forms" || item.href === "/scouting/forms",
      ),
    ).toBe(true);
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
  });

  it("resolves form builder and match checklist under Competition", () => {
    expect(breadcrumbForPath("/scouting/forms")).toBe("Competition / Form builder");
    expect(breadcrumbForPath("/match-checklist")).toBe("Competition / Match Checklist");
    const competition = PRODUCT_NAV_GROUPS.find((g) => g.label === "Competition")!;
    expect(competition.items.some((i) => i.href === "/competition?tab=forms")).toBe(true);
    expect(competition.items.some((i) => i.href === "/competition?tab=match-checklist")).toBe(true);
    expect(competition.items.some((i) => i.href === "/competition?tab=strategy")).toBe(true);
    expect(competition.items.some((i) => i.href === "/competition?tab=scouting")).toBe(true);
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
