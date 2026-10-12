import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { nextMenuIndex } from "./app-shell-account-menu";

/*
  A6-16 / A1-22: the avatar's menu is role="menu" but focus never entered it; the items were only
  reachable by tabbing past them blind.
*/

describe("account menu keys", () => {
  it("arrows wrap, Home and End jump, other keys are not the menu's", () => {
    expect(nextMenuIndex("ArrowDown", 0, 3)).toBe(1);
    expect(nextMenuIndex("ArrowDown", 2, 3)).toBe(0);
    expect(nextMenuIndex("ArrowUp", 0, 3)).toBe(2);
    expect(nextMenuIndex("ArrowDown", -1, 3)).toBe(0);
    expect(nextMenuIndex("Home", 2, 3)).toBe(0);
    expect(nextMenuIndex("End", 0, 3)).toBe(2);
    expect(nextMenuIndex("Enter", 0, 3)).toBeNull();
    expect(nextMenuIndex("ArrowDown", 0, 0)).toBeNull();
  });

  it("focuses the first item on open and hands focus back on Escape or Tab", () => {
    const source = readFileSync(join(__dirname, "app-shell-account-menu.tsx"), "utf8");
    expect(source).toMatch(/if \(open\) menuItems\(menuRef\.current\)\[0\]\?\.focus\(\);/);
    expect(source).toMatch(/event\.key === "Escape" \|\| event\.key === "Tab"/);
    expect(source).toMatch(/document\.querySelector<HTMLButtonElement>\("\.soft-avatar-btn"\)\?\.focus\(\)/);
    const topbar = readFileSync(join(__dirname, "app-shell-topbar.tsx"), "utf8");
    expect(topbar).toMatch(/aria-controls=\{accountMenuOpen \? "soft-account-menu" : undefined\}/);
  });
});
