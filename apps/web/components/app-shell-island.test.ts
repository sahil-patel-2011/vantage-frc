import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppShellIsland } from "./app-shell-island";
import { PLACES, type PlaceId } from "../lib/nav/places";

/*
  A6-14: on Team, Build, Business, Account… nothing in the phone's bottom bar was current, and
  Team/Build/Business were only behind the top-left menu. A6-20: a tap gave no sign for seconds.
  The five places settle both: the bar is Home, Competition, Team, Build and Business, always.
*/

function island(currentPlace: PlaceId | null, unreadMessages = 0) {
  return renderToStaticMarkup(
    createElement(AppShellIsland, { orgId: "org-1", places: [...PLACES], currentPlace, unreadMessages }),
  );
}

describe("bottom bar", () => {
  it("is the five places, in order, with no More", () => {
    const markup = island("home");
    const labels = [...markup.matchAll(/<span>([^<]+)<\/span>/g)].map((match) => match[1]);
    expect(labels).toEqual(["Home", "Compete", "Team", "Build", "Business"]);
    expect(markup).not.toMatch(/More|vantage-navigation-panel/);
    expect(markup).toMatch(/aria-label="Competition"/);
  });

  it("marks the place you are in, and only that one", () => {
    expect(island("build")).toMatch(/aria-label="Build" aria-current="page" href="\/build\?orgId=org-1"/);
    expect(island("build").match(/aria-current/g)).toHaveLength(1);
    expect(island(null)).not.toMatch(/aria-current/);
  });

  it("puts Team chat's unread count on Team", () => {
    expect(island("home", 3)).toMatch(/aria-label="Team, 3 unread messages"[\s\S]*?<b class="soft-island-badge">3<\/b>/);
  });

  it("shows a pending tab until its page arrives, and styles it", () => {
    const source = readFileSync(join(__dirname, "app-shell-island.tsx"), "utf8");
    expect(source).toMatch(/setPendingHref\(place\.href\)/);
    expect(source).toMatch(/data-pending=\{pending \? "true" : undefined\}/);
    const css = readFileSync(join(__dirname, "..", "app", "shell-clarity.css"), "utf8");
    expect(css).toMatch(/\.soft-island a\[data-pending="true"\]::after/);
    expect(css).toMatch(/animation: island-pending var\(--dur-page\)/);
  });
});
