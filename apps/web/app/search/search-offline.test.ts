import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Search last snapshot stays on the phone", () => {
  it("reads and writes the search IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "search-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"search"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Search"/);
    expect(src).toMatch(/Choose your team/);
    expect(src).not.toMatch(/No workspace to search/);
  });
});
