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
  it("Account, everywhere it is linked", () => {
    expect(read("components/app-shell-sidebar.tsx")).toMatch(/\{ href: "\/account", label: "Account"/);
    expect(read("components/app-shell-account-menu.tsx")).toMatch(/<span>Account<\/span>/);
    expect(read("components/app-shell-nav-panel.tsx")).toMatch(/<strong>Account<\/strong>/);
    for (const file of ["components/app-shell-sidebar.tsx", "components/app-shell-account-menu.tsx", "components/app-shell-nav-panel.tsx"]) {
      expect(read(file)).not.toMatch(/Personal settings|Account and settings|label: "Settings"/);
    }
  });

  it("Tasks: the sidebar, the Team hub tab, its page and Home", () => {
    expect(read("components/app-shell-sidebar.tsx")).toMatch(/\{ href: "\/todos", label: "Tasks"/);
    expect(tabLabel("team", "todos")).toBe("Tasks");
    expect(read("app/todos/page.tsx")).toMatch(/title: "Tasks"/);
    expect(read("app/dashboard/dashboard-home-tasks.tsx")).toMatch(/<h2 id=\{titleId\}>Tasks<\/h2>/);
  });

  it("Help, in US spelling, with one word in every menu", () => {
    expect(shellTitleForPath("/help")).toBe("Help");
    expect(read("components/app-shell-sidebar.tsx")).toMatch(/\{ href: "\/help", label: "Help"/);
    expect(read("components/app-shell-account-menu.tsx")).toMatch(/<span>Help<\/span>/);
    expect(read("app/help/help-client.tsx")).not.toMatch(/Help centre/);
  });

  it("My Day, Shop hours, Hours kiosk, Safety training, Robot status, Learn and Guided tracks", () => {
    expect(read("components/app-shell-sidebar.tsx")).toMatch(/label: "My Day"/);
    expect(tabLabel("team", "hours")).toBe("Shop hours");
    expect(read("lib/hours/hours-related.ts")).toMatch(/label: "Hours kiosk", kind: "path" as const, path: "\/hours\/kiosk"/);
    expect(tabLabel("team", "safety-training")).toBe("Safety training");
    expect(read("app/pit/page.tsx")).toMatch(/title: "Robot status"/);
    expect(tabLabel("build", "learn-resources")).toBe("Learn");
    expect(read("app/learn/page.tsx")).toMatch(/title: "Learn"/);
    expect(read("app/learn/guided/page.tsx")).toMatch(/<h1>Guided tracks<\/h1>/);
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
