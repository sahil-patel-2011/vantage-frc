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
    // The button itself (its label, then </Button>), not a comment that mentions it.
    const label = todos.search(/>\s*Mark done\s*<\/Button>/);
    expect(label).toBeGreaterThan(0);
    const markDone = todos.slice(todos.lastIndexOf("<Button", label), label);
    expect(markDone).toMatch(/variant="secondary"/);
  });

  it("Code has one filled button per tab: Run risk review, then one scan", () => {
    const coach = read("app/code/code-coach-panel.tsx");
    // Empty editor: Load teaching sample is the one filled button; with code, Run risk review is.
    expect(coach).toMatch(/variant=\{hasSource \? "primary" : "secondary"\} type="button" disabled=\{busy \|\| !hasSource\} onClick=\{runReview\}/);
    expect(coach.match(/variant="primary"/g)?.length).toBe(1);
    expect(coach).not.toMatch(/Run AI Bugbot|Reset sample/);
    const bugbot = read("app/code/code-bugbot-panel.tsx");
    // Exactly one of the two scans is filled: the repo when GitHub is linked, else the file.
    expect(bugbot).toMatch(/variant=\{githubConnected \? "secondary" : "primary"\}[\s\S]*?Scan this file/);
    expect(bugbot).toMatch(/variant=\{githubConnected \? "primary" : "secondary"\}[^>]*className="cdc-scan-repo"/);
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
