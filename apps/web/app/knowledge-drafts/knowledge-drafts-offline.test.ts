import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Knowledge drafts last snapshot stays on the phone", () => {
  it("reads and writes the knowledge-drafts IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "knowledge-drafts-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"knowledge-drafts"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Knowledge drafts"/);
  });
});
