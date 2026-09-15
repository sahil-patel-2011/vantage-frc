import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

function src(rel: string) {
  return readFileSync(join(WEB, rel), "utf8");
}

describe("leftover Research / Lovat lookup chrome", () => {
  it("locks Needs setup, Choose your team, Compared to this event, and Rating", () => {
    const related = src("lib/intel/intel-related.ts");
    expect(related).toMatch(/badge: "Needs setup"/);
    expect(related).toMatch(/Choose your team/);
    expect(src("app/intel/intel-lookup-board.tsx")).toMatch(/Compared to this event/);
    expect(src("app/intel/intel-ready-view.tsx")).toMatch(/\bRating\b/);
    expect(src("app/intel/intel-ready-view.tsx")).not.toMatch(/\bEPA\b/);
  });

  it("keeps notes, path empty, and predictor honest", () => {
    expect(src("app/intel/intel-lookup-notes.tsx")).toMatch(
      /Needs setup — lookup notes are not on this database yet/,
    );
    expect(src("app/intel/intel-path-visualizer.tsx")).toMatch(
      /Needs setup — no auto paths on file yet/,
    );
    expect(src("app/intel/intel-win-panel.tsx")).toMatch(/Match predictor/);
    expect(src("app/intel/intel-win-panel.tsx")).toMatch(/Flip red and blue/);
    expect(src("app/intel/intel.css")).toMatch(/minmax\(5\.35rem,1fr\)/);
  });
});
