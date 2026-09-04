import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const snapshot = readFileSync(join(__dirname, "snapshot.ts"), "utf8");
const widgets = readFileSync(join(__dirname, "../../app/dashboard/widgets.tsx"), "utf8");

describe("Dashboard prediction honesty", () => {
  it("refuses DEMO stored rows and links to Strategy recompute", () => {
    expect(snapshot).toContain("isDemoPrediction");
    expect(snapshot).toContain("Last stored row is a DEMO prediction");
    expect(snapshot).toContain("teamKeys");
    expect(snapshot).toContain("ourAlliance");
    expect(widgets).toContain("predictionWinDisplay");
    expect(widgets).toContain("data.ourAlliance");
    expect(widgets).toContain("Recompute on Strategy");
    expect(widgets).not.toContain('alliance: "red"');
    expect(widgets).not.toMatch(/Math\.round\(pRed \* 100\)/);
  });

  it("reads real ai_usage_events tokens and never fabricates a per-team count", () => {
    expect(snapshot).toContain("FROM ai_usage_events");
    expect(snapshot).toContain("sum(total_tokens)");
    expect(snapshot).toContain("isPlatformAdmin");
    expect(snapshot).toContain("HAVING count(e.id) > 0");
    expect(widgets).toContain("formatTokenCount");
    expect(widgets).not.toContain("DEMO tokens");
  });
});
