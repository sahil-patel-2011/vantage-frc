import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const web = (...parts: string[]) => readFileSync(join(__dirname, "..", ...parts), "utf8");

describe("Prediction SQL refuses DEMO rows", () => {
  it("filters model_version / caveats demo on accuracy and match-delta queries", () => {
    // The insight loaders moved beside the route so Ask AI skills read the same rows.
    expect(web("lib/ai-insights-load.ts")).toContain("!~* 'demo'");
    expect(web("lib/match-delta-watcher/compute-match-delta-watcher.ts")).toContain("!~* 'demo'");
    expect(web("lib/display.ts")).toContain("!~* 'demo'");
    expect(web("lib/dashboard/snapshot.ts")).toContain("isDemoPrediction");
  });
});
