import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("AI subscription bridge last snapshot stays on the phone", () => {
  it("reads and writes the ai-bridge IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "ai-bridge-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"ai-bridge"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="AI subscription bridge"/);
    expect(src).toMatch(/title="AI subscription bridge"/);
    expect(src).toMatch(/PERSONAL_CLAUDE_TITLE/);
    expect(src).toMatch(/scope: pairScope/);
    expect(src).not.toMatch(/docs\/AI_BRIDGE\.md/);
    expect(src).not.toMatch(/node bridge\.mjs/);
    expect(src).not.toMatch(/0486/);
    expect(src).not.toMatch(/Setup required/);
    expect(src).not.toMatch(/VANTAGE \//);
    expect(src).not.toMatch(/ONSHAPE_|vantage-cad|key_source|\bCLI\b/);
    expect(src).toMatch(/Choose your team/);
  });
});
