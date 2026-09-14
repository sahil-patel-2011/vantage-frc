import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Disagreements last snapshot stays on the phone", () => {
  it("reads and writes the scout-disagreements IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "scout-disagreements-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"scout-disagreements"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Disagreements"/);
  });
});
