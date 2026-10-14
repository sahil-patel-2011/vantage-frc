import { describe, expect, it } from "vitest";
import { ADMIN_DESTINATIONS, MORE_PAGES, activeAdminDestination } from "./admin-subnav";

describe("platform admin navigation", () => {
  it("is one short row: at most seven places, with Feedback one of them", () => {
    // Four tabs over fourteen links used to make you guess a tab before finding a page.
    expect(ADMIN_DESTINATIONS.length).toBeLessThanOrEqual(7);
    expect(ADMIN_DESTINATIONS.map((d) => d.label)).toEqual([
      "Overview",
      "Teams",
      "AI credits",
      "Health",
      "Feedback",
      "Platform admins",
      "All admin tools",
    ]);
  });

  it("keeps /admin as the Overview only, not a prefix that swallows every page", () => {
    expect(activeAdminDestination("/admin")).toBe("overview");
    expect(activeAdminDestination("/admin/")).toBe("overview");
    expect(activeAdminDestination("/admin/teams")).toBe("teams");
    expect(activeAdminDestination("/admin/feedback")).toBe("feedback");
    expect(activeAdminDestination("/admin/admins")).toBe("admins");
  });

  it("matches a deeper route inside a place", () => {
    expect(activeAdminDestination("/admin/health/database")).toBe("health");
    expect(activeAdminDestination("/admin/ai-credits/keys")).toBe("ai-credits");
  });

  it("files every secondary page under More, and never leaves the row blank", () => {
    for (const page of MORE_PAGES) expect(activeAdminDestination(page.href)).toBe("more");
    expect(activeAdminDestination("/admin/something-new")).toBe("more");
    // A prefix is not a match: /admin/teamsheets is not Teams.
    expect(activeAdminDestination("/admin/teamsheets")).toBe("more");
  });

  it("no longer offers the selling pages: Vantage is free", () => {
    const everywhere = [...ADMIN_DESTINATIONS.map((d) => d.href), ...MORE_PAGES.map((p) => p.href)];
    expect(everywhere).not.toContain("/admin/plans");
    expect(everywhere).not.toContain("/admin/commercial");
  });
});
