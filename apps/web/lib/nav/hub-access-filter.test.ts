import { describe, expect, it } from "vitest";
import {
  clientCanAccessHub,
  clientCanAccessHubTab,
  filterSponsorTabs,
  filterTabsByHubAccess,
  hubIdForPath,
  pathAllowedByHubAccess,
  pathAllowedBySponsors,
  type ClientHubAccessRow,
} from "./hub-access-filter";

describe("hub-access-filter", () => {
  const restricted: ClientHubAccessRow[] = [
    { hubId: "media", allowedTabIds: ["calendar", "drafts"] },
    { hubId: "business", allowedTabIds: ["grants"] },
  ];

  it("treats empty rows as unrestricted", () => {
    expect(clientCanAccessHub([], "competition")).toBe(true);
    expect(clientCanAccessHubTab(null, "business", "sponsors")).toBe(true);
  });

  it("allowlists hubs and tabs", () => {
    expect(clientCanAccessHub(restricted, "media")).toBe(true);
    expect(clientCanAccessHub(restricted, "competition")).toBe(false);
    expect(clientCanAccessHubTab(restricted, "media", "calendar")).toBe(true);
    expect(clientCanAccessHubTab(restricted, "media", "impact")).toBe(false);
    expect(clientCanAccessHubTab(restricted, "business", "grants")).toBe(true);
  });

  it("empty allowedTabIds means all tabs in hub", () => {
    const rows: ClientHubAccessRow[] = [{ hubId: "team", allowedTabIds: [] }];
    expect(clientCanAccessHubTab(rows, "team", "messages")).toBe(true);
  });

  it("filters tab lists", () => {
    const tabs = [{ id: "calendar" }, { id: "impact" }, { id: "drafts" }];
    expect(filterTabsByHubAccess(tabs, restricted, "media").map((t) => t.id)).toEqual([
      "calendar",
      "drafts",
    ]);
  });

  it("hides sponsor tabs when sponsors not allowed", () => {
    const tabs = [{ id: "budget" }, { id: "sponsors" }, { id: "grants" }];
    expect(filterSponsorTabs(tabs, false).map((t) => t.id)).toEqual(["budget", "grants"]);
    expect(filterSponsorTabs(tabs, null).map((t) => t.id)).toEqual(["budget", "sponsors", "grants"]);
  });

  it("hides sponsor drawer paths when sponsors not allowed", () => {
    expect(pathAllowedBySponsors("/sponsor-wall", false)).toBe(false);
    expect(pathAllowedBySponsors("/matching-gift-finder", false)).toBe(false);
    expect(pathAllowedBySponsors("/business?tab=sponsors", false)).toBe(false);
    expect(pathAllowedBySponsors("/business?tab=grants", false)).toBe(true);
    expect(pathAllowedBySponsors("/sponsor-suite", null)).toBe(true);
    expect(pathAllowedBySponsors("/costs", false)).toBe(true);
  });

  it("filters nav hrefs by hub access", () => {
    expect(pathAllowedByHubAccess("/dashboard", restricted)).toBe(true);
    expect(pathAllowedByHubAccess("/media?tab=calendar", restricted)).toBe(true);
    expect(pathAllowedByHubAccess("/media?tab=impact", restricted)).toBe(false);
    expect(pathAllowedByHubAccess("/competition", restricted)).toBe(false);
  });

  it("maps business and sponsor paths to the business hub", () => {
    expect(hubIdForPath("/business")).toBe("business");
    expect(hubIdForPath("/sponsor-suite")).toBe("business");
    expect(hubIdForPath("/matching-gift-finder")).toBe("business");
    expect(hubIdForPath("/media")).toBe("media");
  });
});
