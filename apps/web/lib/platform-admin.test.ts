import { describe, expect, it } from "vitest";

/** Mirrors apps/web hamburger + command-palette platform gating. */
function platformNavItems(platformAdmin: boolean) {
  const items: Array<{ href: string; label: string }> = [{ href: "/team", label: "Admin" }];
  if (platformAdmin) items.push({ href: "/admin", label: "Global Team Manager" });
  return items;
}

describe("platform admin UI discovery", () => {
  it("hides Global Team Manager from non-platform users including org admins", () => {
    const items = platformNavItems(false);
    expect(items.some((item) => item.href === "/admin")).toBe(false);
    expect(items.some((item) => item.label === "Global Team Manager")).toBe(false);
    expect(items.some((item) => item.href === "/team")).toBe(true);
  });

  it("shows Global Team Manager only for platform_admins", () => {
    const items = platformNavItems(true);
    expect(items).toContainEqual({ href: "/admin", label: "Global Team Manager" });
  });
});
