import { describe, expect, it } from "vitest";
import { activeAdminGroup } from "./admin-subnav";

describe("activeAdminGroup", () => {
  it("opens the group that owns the page you are on", () => {
    expect(activeAdminGroup("/admin").label).toBe("Workspace");
    expect(activeAdminGroup("/admin/analytics").label).toBe("Data");
    expect(activeAdminGroup("/admin/models").label).toBe("Operations");
    expect(activeAdminGroup("/admin/plans").label).toBe("Settings");
  });

  it("keeps /admin as Teams only, not a prefix that swallows every page", () => {
    // Every other entry owns a subtree; "/admin" alone must not match them.
    expect(activeAdminGroup("/admin/audit").label).toBe("Data");
    expect(activeAdminGroup("/admin/connectors").label).toBe("Operations");
  });

  it("matches a deeper route inside a section", () => {
    expect(activeAdminGroup("/admin/support/ticket/42").label).toBe("Workspace");
    expect(activeAdminGroup("/admin/releases/new").label).toBe("Settings");
  });

  it("never leaves the row blank on an unfiled route", () => {
    // A admin page with no navigation is worse than one showing the first tab.
    const group = activeAdminGroup("/admin/something-new");
    expect(group).toBeDefined();
    expect(group.links.length).toBeGreaterThan(0);
  });

  it("shows far fewer links at once than the flat row it replaced", () => {
    // Fourteen destinations used to be on screen at all times.
    const shown = activeAdminGroup("/admin").links.length;
    expect(shown).toBeLessThanOrEqual(4);
  });
});
