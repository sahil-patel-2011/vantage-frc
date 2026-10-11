import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
  A6-13: more than one filled button per view. Tasks had a filled Mark done on every row next to
  Add; Code had Run risk review and Scan this file; Hours had Scan and Clock in; the selected
  "Event" segment of Add event looked like a second Save; Money's Add sat beside the empty
  state's "Set your season budget".
*/

const WEB = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(WEB, path), "utf8");

describe("one filled button per view", () => {
  it("row actions on Tasks are secondary", () => {
    const todos = read("app/todos/todos-client.tsx");
    const markDone = todos.slice(todos.lastIndexOf("<Button", todos.indexOf("Mark done")), todos.indexOf("Mark done"));
    expect(markDone).toMatch(/variant="secondary"/);
  });

  it("Code keeps Run risk review as its one filled button", () => {
    expect(read("app/code/code-coach-panel.tsx")).toMatch(/className="primary-action"[^>]*onClick=\{runReview\}/);
    const bugbot = read("app/code/code-bugbot-panel.tsx");
    const scan = bugbot.slice(bugbot.indexOf('<footer className="cdc-bugbot-actions">'), bugbot.indexOf('"Scan this file"'));
    expect(scan).toMatch(/className="app-button secondary"/);
    expect(scan).not.toMatch(/primary-action/);
  });

  it("Hours' Clock in is the fallback to scanning, so secondary", () => {
    const view = read("app/hours/hours-ready-view.tsx");
    const clockIn = view.slice(view.lastIndexOf("<Button", view.indexOf('action: "clock_in"')), view.indexOf('action: "clock_in"'));
    expect(clockIn).toMatch(/variant="secondary"/);
  });

  it("a selected segment and Money's Add are not filled with the accent", () => {
    const css = read("app/shell-clarity.css");
    expect(css).toMatch(/\.tc-entry-switch button\.active \{\n {2}color: var\(--ink\);\n {2}background: var\(--surface\);/);
    expect(css).toMatch(/main:has\(\.scan-empty :is\(\.is-primary, \.app-button\.primary\)\) \.money-add > \.app-button \{/);
  });
});
