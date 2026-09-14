import { describe, expect, it } from "vitest";
import { planDrawingPack } from "../src/drawing-pack";

describe("labeled Onshape drawing packs", () => {
  it("keeps one labeled sheet when every size is the same", () => {
    const sheets = planDrawingPack({
      partName: "Plate",
      dims: { widthMm: 80, heightMm: 80, depthMm: 80 },
    });
    expect(sheets).toHaveLength(1);
    expect(sheets[0]?.views).toEqual(["front", "top", "iso"]);
    expect(sheets[0]?.callouts.some((item) => item.label === "Width" && item.valueMm === 80)).toBe(true);
    expect(sheets[0]?.notes.join(" ")).toMatch(/cast the solid/);
  });

  it("adds a side sheet when faces have different millimetres", () => {
    const sheets = planDrawingPack({
      partName: "Bracket",
      dims: { widthMm: 80, heightMm: 40, depthMm: 12 },
    });
    expect(sheets.map((sheet) => sheet.name)).toEqual(["Bracket — front and top", "Bracket — side"]);
    expect(sheets[1]?.views).toEqual(["side", "iso"]);
    expect(sheets[1]?.callouts.some((item) => item.label === "Depth" && item.valueMm === 12)).toBe(true);
  });

  it("adds a hole sheet only when the brief mentions holes and sizes exist", () => {
    const withHoles = planDrawingPack({
      partName: "Bellypan",
      dims: { widthMm: 200, heightMm: 120 },
      briefSummary: "plate with a bolt pattern",
    });
    expect(withHoles.some((sheet) => sheet.name.includes("holes"))).toBe(true);
    const noSizes = planDrawingPack({
      partName: "Bellypan",
      dims: {},
      briefSummary: "plate with a bolt pattern",
    });
    expect(noSizes).toHaveLength(1);
    expect(noSizes[0]?.callouts).toEqual([]);
    expect(noSizes[0]?.notes.join(" ")).toMatch(/Do not invent sizes/);
  });
});
