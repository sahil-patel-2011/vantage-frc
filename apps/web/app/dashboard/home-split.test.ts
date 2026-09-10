import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DASHBOARD_WIDGET_TYPES } from "../../lib/dashboard/catalog";

const DIR = __dirname;

describe("Home first-paint JS split", () => {
  it("does not statically import mentor/competition widgets or extra cards", () => {
    const src = readFileSync(join(DIR, "widgets.tsx"), "utf8");
    expect(src).not.toMatch(/from ["']\.\/widgets\/ops-cards["']/);
    expect(src).not.toMatch(/from ["']\.\/widgets\/extra-cards["']/);
    expect(src).not.toMatch(/from ["']\.\/widgets\/extra-widget-view["']/);
    expect(src).toMatch(/import\(["']\.\/widgets\/extra-widget-view["']\)/);
    expect(src).toMatch(/"team_todos"/);
    expect(src).toMatch(/"onboarding_checklist"/);
  });

  it("loads Edit Home chrome and partner strip only through next/dynamic", () => {
    const src = readFileSync(join(DIR, "dashboard-home-view.tsx"), "utf8");
    expect(src).not.toMatch(/from ["']\.\/dashboard-boards-modal["']/);
    expect(src).not.toMatch(/from ["']\.\/dashboard-edit-dock["']/);
    expect(src).not.toMatch(/from ["']\.\/dashboard-widget-library["']/);
    expect(src).not.toMatch(/from ["']\.\/dashboard-widget-palette["']/);
    expect(src).not.toMatch(/from ["']\.\.\/\.\.\/components\/partner-placement["']/);
    expect(src).toMatch(/import\(["']\.\/dashboard-boards-modal["']\)/);
    expect(src).toMatch(/import\(["']\.\/dashboard-edit-dock["']\)/);
    expect(src).toMatch(/import\(["']\.\/dashboard-widget-library["']\)/);
    expect(src).toMatch(/import\(["']\.\/dashboard-widget-palette["']\)/);
    expect(src).toMatch(/import\(["']\.\.\/\.\.\/components\/partner-placement["']\)/);
  });

  it("keeps every catalog widget in the student switch or the extra/ops chunk", () => {
    const student = readFileSync(join(DIR, "widgets.tsx"), "utf8");
    const extra = readFileSync(join(DIR, "widgets", "extra-widget-view.tsx"), "utf8");
    const ops = readFileSync(join(DIR, "widgets", "ops-cards.tsx"), "utf8");
    for (const type of DASHBOARD_WIDGET_TYPES) {
      const needle = `case "${type}"`;
      const handled =
        student.includes(needle) || extra.includes(needle) || ops.includes(needle);
      expect(handled, `${type} needs a case in widgets.tsx, extra-widget-view, or ops-cards`).toBe(
        true,
      );
    }
  });
});
