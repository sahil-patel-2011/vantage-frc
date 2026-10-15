import { describe, expect, it } from "vitest";
import { findTitleBlockFields, runDrawingChecks, sortForReading, summaryLine, type CadCheckResult } from "./checks";
import { parseDxf } from "./dxf";
import { BARE_SKETCH, EMPTY_DRAWING, GOOD_DRAWING, HIDDEN_LAYERS } from "./fixtures";

function report(text: string) {
  const parsed = parseDxf(text);
  if (!parsed.ok) throw new Error(parsed.reason);
  return runDrawingChecks(parsed.drawing);
}

const byId = (results: CadCheckResult[]) => Object.fromEntries(results.map((r) => [r.id, r]));

describe("drawing checks", () => {
  it("passes a good shop drawing on every check", () => {
    const r = report(GOOD_DRAWING);
    expect(r.results.map((x) => [x.id, x.status])).toEqual([
      ["units", "pass"],
      ["geometry", "pass"],
      ["layer-zero", "pass"],
      ["layer-names", "pass"],
      ["unused-layers", "pass"],
      ["hidden-layers", "pass"],
      ["dimensions", "pass"],
      ["title-block", "pass"],
      ["text-height", "pass"],
    ]);
    expect(byId(r.results).units!.why).toBe("The drawing is in inches.");
    expect(summaryLine(r)).toBe("9 of 9 checks pass");
  });

  it("fails a bare sketch for units, layer 0, dimensions and title block", () => {
    const results = byId(report(BARE_SKETCH).results);
    expect(results.units!.status).toBe("fail");
    expect(results.units!.why).toContain("metric defaults");
    expect(results["layer-zero"]!.status).toBe("fail");
    expect(results["layer-names"]!.status).toBe("warn");
    expect(results["layer-names"]!.why).toContain("“Layer1”");
    expect(results["unused-layers"]!.status).toBe("warn");
    expect(results.dimensions!.status).toBe("fail");
    expect(results["title-block"]!.status).toBe("fail");
    // No units, so text height can't be judged: it says so rather than guessing.
    expect(results["text-height"]!.status).toBe("warn");
    expect(results["text-height"]!.why).toMatch(/^Couldn't check/);
  });

  it("warns on hidden layers, small metric text, exploded dimensions and a partial title block", () => {
    const r = report(HIDDEN_LAYERS);
    const results = byId(r.results);
    expect(results.units!.status).toBe("pass");
    expect(results.units!.why).toContain("millimetres");
    expect(results["hidden-layers"]!.status).toBe("warn");
    expect(results["hidden-layers"]!.why).toContain("Old revision (frozen)");
    expect(results["hidden-layers"]!.why).toContain("Notes (off)");
    expect(results["unused-layers"]!.why).toContain("“Spare”");
    expect(results.dimensions!.status).toBe("warn");
    expect(results["text-height"]!.status).toBe("warn");
    expect(results["text-height"]!.why).toContain("1.20 mm");
    expect(results["title-block"]!.status).toBe("warn");
    expect(results["title-block"]!.why).toContain("Date, Material, Revision");
    expect(summaryLine(r)).toBe("4 of 9 checks pass · 5 to look at");
  });

  it("runs only units and geometry on an empty drawing", () => {
    const r = report(EMPTY_DRAWING);
    expect(r.results.map((x) => [x.id, x.status])).toEqual([
      ["units", "pass"],
      ["geometry", "fail"],
    ]);
    expect(r.skipped).toBe(7);
  });

  it("gives every result a why and a fix", () => {
    for (const fixture of [GOOD_DRAWING, BARE_SKETCH, HIDDEN_LAYERS, EMPTY_DRAWING]) {
      for (const result of report(fixture).results) {
        expect(result.why.length).toBeGreaterThan(10);
        expect(result.fix.length).toBeGreaterThan(5);
      }
    }
  });
});

describe("title block fields", () => {
  it("does not count a note that only mentions a word", () => {
    const parsed = parseDxf(BARE_SKETCH);
    if (!parsed.ok) throw new Error(parsed.reason);
    const d = { ...parsed.drawing, texts: [{ type: "TEXT" as const, layer: "0", height: 3, value: "Check the material and the date before cutting" }] };
    expect(findTitleBlockFields(d).found).toEqual([]);
  });
});

describe("sortForReading", () => {
  it("puts failures first, then warnings, keeping check order", () => {
    const r = report(BARE_SKETCH);
    const sorted = sortForReading(r.results).map((x) => x.status);
    expect(sorted).toEqual([...sorted].sort((a, b) => ["fail", "warn", "pass"].indexOf(a) - ["fail", "warn", "pass"].indexOf(b)));
    expect(sortForReading(r.results)[0]!.id).toBe("units");
  });
});
