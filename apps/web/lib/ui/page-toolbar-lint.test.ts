/**
 * Migrated routes render their header and card toolbars through PageHeader or
 * PageToolbar. A raw header that still draws its own buttons, or a known
 * toolbar class that is not inside that shared control, fails here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/** Toolbar class names that must be owned by the shared control. */
const TOOLBAR_CLASSES = [
  "header-actions",
  "header-meta",
  "bp-actions",
  "dash-board-tools",
  "intel-primary-actions",
  "messages-channel-actions",
  "quick-actions",
  // `notif-toolbar-actions` is the inbox "Show older" pager, one quiet button
  // under the list. It is not the header toolbar (that one is PageToolbar).
];

const MIGRATED = [
  "app/strategy/strategy-client.tsx",
  "app/schedule/schedule-client.tsx",
  "app/scouting/scouting-ready-view.tsx",
  "app/files/files-client.tsx",
  "app/command/command-chrome.tsx",
  "app/dashboard/dashboard-home-view.tsx",
  "app/ranking-projection/ranking-projection-client.tsx",
  "app/messages/messages-ready-view.tsx",
  "app/intel/intel-ready-view.tsx",
  "app/workspace/quick-actions.tsx",
  "app/notifications/notifications-client.tsx",
  "app/pit/pit-command-client.tsx",
  "app/todos/todos-client.tsx",
  "app/my-day/my-day-client.tsx",
  "app/calendar/calendar-client.tsx",
  "app/hours/hours-chrome.tsx",
  "app/account/account-client.tsx",
  "components/settings-layout.tsx",
  "app/match-sim/match-sim-client.tsx",
  "app/scout/scouting-home.tsx",
  "components/ui/page-header.tsx",
];

function owned(source: string, index: number): boolean {
  const before = source.slice(Math.max(0, index - 4000), index);
  const headerOpen = before.lastIndexOf("<PageHeader");
  const headerClose = before.lastIndexOf("</PageHeader>");
  if (headerOpen > headerClose) return true;
  const toolOpen = before.lastIndexOf("<PageToolbar");
  const toolClose = before.lastIndexOf("</PageToolbar>");
  if (toolOpen > toolClose) return true;
  const after = source.slice(index, index + 500);
  return after.includes("<PageToolbar") || after.includes("<PageHeader");
}

describe("page toolbar lint", () => {
  it("routes the shared header through PageToolbar", () => {
    const header = readFileSync(join(WEB, "components/ui/page-header.tsx"), "utf8");
    const toolbar = readFileSync(join(WEB, "components/ui/page-toolbar.tsx"), "utf8");
    expect(header).toContain("PageToolbar");
    expect(header).not.toContain("actions.slice(0, 2)");
    expect(toolbar).toContain("data-page-toolbar");
    expect(toolbar).toContain("layoutPageToolbar");
    expect(toolbar).toContain("isMarkedToolbarAction");
    const css = readFileSync(join(WEB, "components/ui/page-toolbar.css"), "utf8");
    expect(css).toContain(".app-page-actions .page-toolbar-actions[data-has-actions=\"true\"]");
    expect(css).not.toMatch(/^\s*\.page-toolbar-actions\[data-has-actions="true"\]\s*\{/m);
  });

  it("keeps migrated toolbar clusters inside the shared control", () => {
    const problems: string[] = [];
    for (const file of MIGRATED) {
      const source = readFileSync(join(WEB, file), "utf8");
      if (/<header\b[^>]*className="[^"]*\bapp-page-header\b/.test(source) && !source.includes("<PageHeader")) {
        problems.push(`${file} draws a raw page header`);
      }
      for (const name of TOOLBAR_CLASSES) {
        let from = 0;
        while (from < source.length) {
          const at = source.indexOf(name, from);
          if (at < 0) break;
          if (!owned(source, at)) problems.push(`${file} has ${name} outside PageHeader or PageToolbar`);
          from = at + name.length;
        }
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("keeps the analytics banner from drawing a filled brand button", () => {
    const css = readFileSync(join(WEB, "components/consent-banner.css"), "utf8");
    const start = css.indexOf(".consent-banner-btn--accept");
    expect(start).toBeGreaterThan(-1);
    const rule = css.slice(start, css.indexOf("}", start));
    expect(rule).not.toMatch(/background:\s*var\(--accent\)/);
    expect(rule).toMatch(/background:\s*var\(--surface\)/);
  });
});
