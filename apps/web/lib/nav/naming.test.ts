import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { shellTitleForPath } from "../../components/app-shell-model";
import { hubById } from "./hubs";

/*
  A6-09: the same place had three or four names ("Account and settings", "Personal settings",
  "Settings", "Account"; "Team tasks", "Work", "Task board"). One name per destination, the same
  in the sidebar, the menu panel, the avatar menu, the hub tab, the h1 and the browser tab.
  A6-10: a page with no parent showed its name in the top bar, its breadcrumb and its h1.
*/

const WEB = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(WEB, path), "utf8");
const tabLabel = (hub: Parameters<typeof hubById>[0], id: string) => hubById(hub).tabs.find((tab) => tab.id === id)?.label;

describe("one name per destination", () => {
  it("Settings: one word, one place, the account menu (the sidebar is the five places)", () => {
    // App utilities keep one location. With the five places, that is the avatar menu: the
    // sidebar and the bottom bar navigate, and nothing else.
    expect(read("components/app-shell-account-menu.tsx")).toMatch(/href=\{withOrgHref\(SETTINGS_HREF, orgId\)\}[^>]*>\s*<Icon name="gear" \/><span>Settings<\/span>/);
    expect(read("components/app-shell-sidebar.tsx")).not.toMatch(/SETTINGS_HREF|<span>Settings<\/span>/);
    for (const file of ["components/app-shell-sidebar.tsx", "components/app-shell-account-menu.tsx"]) {
      expect(read(file)).not.toMatch(/Personal settings|Account and settings|label: "Account"|<span>Account<\/span>|<span>Team admin<\/span>/);
    }
  });

  it("Tasks: the pinned apps, the Team hub tab, its page and Home", () => {
    expect(read("lib/nav/pins.ts")).toMatch(/\{ href: "\/team\?tab=todos", label: "Tasks"/);
    expect(tabLabel("team", "todos")).toBe("Tasks");
    expect(read("app/todos/page.tsx")).toMatch(/title: "Tasks"/);
    expect(read("app/dashboard/dashboard-home-tasks.tsx")).toMatch(/<h2 id=\{titleId\}>Tasks<\/h2>/);
  });

  it("Help, in US spelling, with one word in every menu", () => {
    expect(shellTitleForPath("/help")).toBe("Help");
    expect(read("components/app-shell-account-menu.tsx")).toMatch(/<Icon name="book" \/><span>Help<\/span>/);
    expect(read("components/app-shell-sidebar.tsx")).not.toMatch(/<span>Help<\/span>|"\/help"/);
    expect(read("app/help/help-client.tsx")).not.toMatch(/Help centre/);
    // The Help center, in US spelling, with one breadcrumb and no row of links above it.
    const center = read("app/help/help-center.tsx");
    expect(center).toMatch(/>Help center</);
    expect(center).not.toMatch(/centre/i);
    expect(center).not.toMatch(/product-hub-related/);
  });

  it("My Day, Shop hours, Hours kiosk, Safety training, Robot status, Learn and Guided tracks", () => {
    expect(read("lib/nav/pins.ts")).toMatch(/label: "My Day"/);
    expect(tabLabel("team", "hours")).toBe("Shop hours");
    expect(read("lib/hours/hours-related.ts")).toMatch(/label: "Hours kiosk", kind: "path" as const, path: "\/hours\/kiosk"/);
    expect(tabLabel("team", "safety-training")).toBe("Safety training");
    expect(read("app/pit/page.tsx")).toMatch(/title: "Robot status"/);
    expect(tabLabel("build", "learn-resources")).toBe("Learn");
    expect(read("app/learn/page.tsx")).toMatch(/title: "Learn"/);
    expect(read("app/learn/guided/page.tsx")).toMatch(/<h1>Guided tracks<\/h1>/);
  });
});

describe("five places, no repeats", () => {
  it("there is no menu drawer: the sidebar and the bottom bar are the five places", () => {
    const shell = read("components/app-shell.tsx");
    expect(shell).not.toMatch(/AppShellNavPanel|setNavOpen/);
    expect(read("components/app-shell-topbar.tsx")).not.toMatch(/soft-menu-btn|Browse all pages/);
    expect(read("components/app-shell-sidebar.tsx")).toMatch(/\{places\.map\(\(place\) =>/);
    expect(read("components/app-shell-island.tsx")).toMatch(/\{places\.map\(\(place\) =>/);
    expect(shell).toMatch(/const places = useMemo\(\(\) => visiblePlaces\(navHrefAllowed\), \[navHrefAllowed\]\);/);
  });

  it("Sign out is the avatar menu's, once", () => {
    const account = read("components/app-shell-account-menu.tsx");
    expect(read("components/app-shell-sidebar.tsx")).not.toMatch(/>Sign out</);
    expect(account).toMatch(/"Signing out…" : "Sign out"/);
    // Team admin is a section of Settings ("Members and invites"), not a second menu item.
    expect(account).not.toMatch(/Team admin<\/span>/);
  });

  it("one set of pins: the sidebar's Pinned group and the top of search on a phone", () => {
    expect(read("components/app-shell-sidebar.tsx")).toMatch(/pins\.map\(\(item\) =>/);
    expect(read("components/app-shell-search-palette.tsx")).toMatch(/\{pins\.map\(\(pin\) =>/);
    expect(read("components/app-shell.tsx")).toMatch(/pins=\{pinShortcuts\}\n\s*onEditPins=\{openIslandEditor\}/);
    // The stock pins keep the old menu dock's everyday places (Home, Scout, My Day, Tasks).
    const pins = read("lib/nav/pins.ts");
    for (const href of ["/dashboard", "/competition?tab=my-day", "/team?tab=todos", "/learn/team"]) {
      expect(pins).toContain(`href: "${href}"`);
    }
  });
});

describe("one icon per meaning (A6-23)", () => {
  it("Ask AI is sparkles everywhere, Help is a book, Security and Platform admin a shield", () => {
    expect(read("lib/nav/product-nav.ts")).not.toMatch(/label: "Ask AI", icon: "bolt"/);
    // The shell's one Ask AI is the search palette's row ("Search or ask"), with sparkles.
    expect(read("components/app-shell-search-palette.tsx")).toMatch(/className="search-palette-ask"[\s\S]{0,120}<Icon name="sparkles" \/>/);
    expect(read("components/app-shell-topbar.tsx")).not.toMatch(/AskAiTopbarLink/);
    expect(read("components/app-shell-sidebar.tsx")).not.toMatch(/AskAiTopbarLink/);
    const account = read("components/app-shell-account-menu.tsx");
    expect(account).toMatch(/<Icon name="book" \/><span>Help<\/span>/);
    expect(read("lib/nav/settings-nav.ts")).toMatch(/label: "Security", href: "\/security", icon: "shield"/);
    // Platform admin sits with the other app utilities, in the account menu.
    expect(account).toMatch(/href="\/admin"[^>]*>\s*<Icon name="shield" \/><span>Admin<\/span>/);
    expect(account).not.toMatch(/Platform admin/);
  });
});

describe("one accent for the interface (A6-19)", () => {
  it("the Scouting app's document takes the product accent, not the public teal", () => {
    const macos = read("app/macos-product.css");
    expect(macos).toMatch(/^html:not\(\[data-brand-accent\]\):has\(body\.has-app-shell, \.scouting-product\),$/m);
    expect(read("BRAND.md")).toMatch(/## Interface accent/);
  });

  it("every product page title uses one size token (A6-10)", () => {
    const css = read("app/shell-clarity.css");
    expect(css).toMatch(/--page-title: clamp\(28px, 1\.2vw \+ 20px, 34px\);/);
    expect(css).toMatch(/\.scouting-product main :is\(\.app-page-header, \.qs-head\) h1 \{\n {2}font-size: var\(--page-title\);/);
  });
});

describe("top bar: two patterns", () => {
  it("shows the team switcher alone unless the page has a parent to go back to", () => {
    const topbar = read("components/app-shell-topbar.tsx");
    expect(topbar).toMatch(/\{isHubRoot \|\| !showBack \? \(/);
    // The back-button pattern carries a crumb, never a second team switcher.
    const backBranch = topbar.slice(topbar.indexOf('<p className="soft-topbar-title">'));
    expect(backBranch.slice(0, backBranch.indexOf("</div>"))).not.toMatch(/<TeamChip/);
  });
});
