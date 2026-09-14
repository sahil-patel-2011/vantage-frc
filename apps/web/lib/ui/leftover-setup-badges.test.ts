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

  it("Display leftover empties do not say Setup or The Blue Alliance", () => {
    const display = src("app/display/setup-client.tsx");
    expect(display).not.toMatch(/badge="Setup"/);
    expect(display).not.toMatch(/The Blue Alliance/);
    expect(display).toMatch(/id="display-new-board"/);
    expect(display).toMatch(/#display-new-board/);
    expect(display).toMatch(/official scores/);
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
});
