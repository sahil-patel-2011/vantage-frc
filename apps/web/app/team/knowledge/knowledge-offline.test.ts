import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Playbook last snapshot stays on the phone", () => {
  it("reads and writes the knowledge IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "knowledge-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"knowledge"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Playbook"/);
    expect(src).toMatch(/if \(!view\)/);
    expect(src).not.toMatch(/if \(view == null && !fetchFailed\)/);
    expect(src).not.toMatch(/fetchFailed \|\| !view/);
  });
});
