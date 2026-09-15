import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

function src(rel: string) {
  return readFileSync(join(WEB, rel), "utf8");
}

describe("leftover Setup badges become Needs setup or drop the setup tone", () => {
  it("Attendance, Search, Background, and Document roles setup is Needs setup", () => {
    expect(src("app/attendance/attendance-client.tsx")).toMatch(/badge="Needs setup"/);
    expect(src("app/attendance/attendance-client.tsx")).not.toMatch(/badge="Setup"/);
    expect(src("app/search/search-client.tsx")).toMatch(/badge="Needs setup"/);
    expect(src("app/search/search-client.tsx")).not.toMatch(/badge="Setup"/);
    expect(src("app/team/background/page.tsx")).toMatch(/badge="Needs setup"/);
    expect(src("app/doc-roles/doc-roles-client.tsx")).toMatch(/badge="Needs setup"/);
    expect(src("app/doc-roles/doc-roles-client.tsx")).toMatch(/Choose your team/);
  });

  it("Display leftover empties use Needs setup, one primary, and official scores", () => {
    const page = src("app/display/page.tsx");
    expect(page).toMatch(/badge="Needs setup"/);
    expect(page).toMatch(/Choose your team/);
    expect(page).not.toMatch(/VANTAGE \//);
    expect(page).not.toMatch(/\bTBA\b/);
    expect(page).not.toMatch(/The Blue Alliance/);
    expect(page).not.toMatch(/Event Day/);
    expect(page).not.toMatch(/tab=strategy/);
    const inners = page.match(/<EmptyState[\s\S]*?<\/EmptyState>/g) ?? [];
    expect(inners.length).toBe(1);
    expect(inners[0]?.match(/<Button\b/g) ?? []).toHaveLength(1);

    const display = src("app/display/setup-client.tsx");
    expect(display).not.toMatch(/badge="Setup"/);
    expect(display).not.toMatch(/The Blue Alliance/);
    expect(display).not.toMatch(/\bTBA\b/);
    expect(display).toMatch(/id="display-new-board"/);
    expect(display).toMatch(/#display-new-board/);
    expect(display).toMatch(/official scores/);
    expect(display).toMatch(/boards\.length > 0 && activeEventKey/);
    expect(display).toMatch(/boards\.length > 0 && !activeEventKey/);

    const related = src("lib/display/display-related.ts");
    expect(related).not.toMatch(/\bTBA\b/);
    expect(src("lib/display.ts")).not.toMatch(/from TBA"/);
    expect(src("lib/display.ts")).not.toMatch(/plus TBA /);
    expect(src("app/display/kiosk/kiosk-client.tsx")).not.toMatch(/VANTAGE /);
  });

  it("Todos load-failure only uses Needs setup for the setup kind", () => {
    const todos = src("app/todos/todos-client.tsx");
    expect(todos).toMatch(/failure\.kind === "setup" \? "Needs setup"/);
    expect(todos).not.toMatch(/badge="Setup"/);
    expect(todos).toMatch(/badge="Needs setup"/);
  });

  it("Grant allocate leftover empties keep one primary without a Setup badge", () => {
    const spend = src("app/team/grants/allocate-spend.tsx");
    expect(spend).not.toMatch(/badge="Setup"/);
    expect(spend).toMatch(/variant="primary"/);
    expect(spend).toMatch(/Open Business · Grants/);
    expect(spend).toMatch(/Open Season Finance/);
  });

  it("Partner placements leftover empties jump to Add a package", () => {
    const partners = src("app/business/partner-placements-panel.tsx");
    expect(partners).not.toMatch(/badge="Setup"/);
    expect(partners).toMatch(/id="pp-add-package"/);
    expect(partners).toMatch(/#pp-add-package/);
  });

  it("shared Shell setup fallback is Needs setup", () => {
    const shell = src("components/ui/shell.tsx");
    expect(shell).toMatch(/badge="Needs setup"/);
    expect(shell).not.toMatch(/badge="Setup"/);
  });

  it("Research leftover lookup keeps Needs setup, Choose your team, Compared to this event, and Rating", () => {
    const related = src("lib/intel/intel-related.ts");
    expect(related).toMatch(/badge: "Needs setup"/);
    expect(related).toMatch(/Choose your team/);
    expect(src("app/intel/intel-lookup-board.tsx")).toMatch(/Compared to this event/);
    expect(src("app/intel/intel-ready-view.tsx")).toMatch(/\bRating\b/);
    expect(src("app/intel/intel-ready-view.tsx")).not.toMatch(/\bEPA\b/);
    expect(src("app/intel/intel-path-visualizer.tsx")).toMatch(
      /Needs setup — no auto paths on file yet/,
    );
    expect(src("app/intel/intel.css")).toMatch(/minmax\(5\.35rem,1fr\)/);
  });
});
