import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const snapshot = readFileSync(join(__dirname, "snapshot.ts"), "utf8");
const widgets = readFileSync(join(__dirname, "../../app/dashboard/widgets/ops-cards.tsx"), "utf8");

describe("Dashboard prediction honesty", () => {
  it("refuses DEMO stored rows and links to Strategy recompute", () => {
    expect(snapshot).toContain("isDemoPrediction");
    expect(snapshot).not.toMatch(/DEMO prediction/);
    expect(snapshot).toContain("Open Strategy and compute one from your event");
    expect(snapshot).toContain("teamKeys");
    expect(snapshot).toContain("ourAlliance");
    expect(widgets).toContain("predictionWinDisplay");
    expect(widgets).toContain("data.ourAlliance");
    expect(widgets).toContain("Recompute on Strategy");
    expect(widgets).not.toContain('alliance: "red"');
    expect(widgets).not.toMatch(/Math\.round\(pRed \* 100\)/);
  });
});
