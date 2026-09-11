import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Ask AI history last snapshot stays on the phone", () => {
  it("reads and writes the ai-runs IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "ai-runs-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"ai-runs"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Ask AI history"/);
    expect(src).not.toMatch(/VANTAGE \//);
    expect(src).not.toMatch(/orchestrator/);
  });
});
