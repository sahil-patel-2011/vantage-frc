import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppShellIsland } from "./app-shell-island";
import { PRIMARY_TABS } from "../lib/nav/product-nav";

/*
  A6-14: on Team, Build, Business, Account… nothing in the phone's bottom bar was current, and
  Team/Build/Business were only behind the top-left menu. A6-20: a tap gave no sign for seconds.
*/

function island(activeIslandTabHref: string | undefined, navOpen = false) {
  return renderToStaticMarkup(
    createElement(AppShellIsland, {
      orgId: "org-1",
      islandTabs: PRIMARY_TABS,
      activeIslandTabHref,
      unreadMessages: 0,
      onOpenEditor: () => undefined,
      onOpenMore: () => undefined,
      navOpen,
      islandPressTimer: { current: null },
      islandPressOrigin: { current: null },
      islandLongPressed: { current: false },
    }),
  );
}

describe("bottom bar", () => {
  it("ends with Browse, a button that opens the menu of every page", () => {
    // Renamed from "More" in 22ae8cce3 (Simplify product navigation); same button, same panel.
    const markup = island("/dashboard");
    expect(markup).toMatch(/<a class="soft-island-more" href="#vantage-navigation-panel" role="button" aria-label="Browse all pages" aria-controls="vantage-navigation-panel" aria-expanded="false"/);
    expect(markup).toContain("<span>Browse</span>");
  });

  it("marks More as where you are when none of the four apps is", () => {
    expect(island(undefined)).toMatch(/class="soft-island-more"[^>]*aria-current="location"/);
    expect(island("/dashboard")).not.toMatch(/class="soft-island-more"[^>]*aria-current/);
    expect(island("/dashboard")).toMatch(/aria-current="page" href="\/dashboard\?orgId=org-1"/);
  });

  it("shows a pending tab until its page arrives, and styles both states", () => {
    const source = readFileSync(join(__dirname, "app-shell-island.tsx"), "utf8");
    expect(source).toMatch(/setPendingHref\(tab\.href\)/);
    expect(source).toMatch(/data-pending=\{pendingHref === tab\.href && !current \? "true" : undefined\}/);
    const css = readFileSync(join(__dirname, "..", "app", "shell-clarity.css"), "utf8");
    expect(css).toMatch(/\.soft-island a\.soft-island-more\[aria-current="location"\]/);
    expect(css).toMatch(/\.soft-island a\[data-pending="true"\]::after/);
    expect(css).toMatch(/animation: island-pending var\(--dur-page\)/);
  });

  it("is wired to the shell's menu", () => {
    const shell = readFileSync(join(__dirname, "app-shell.tsx"), "utf8");
    expect(shell).toMatch(/onOpenMore=\{toggleMenu\}/);
  });
});
