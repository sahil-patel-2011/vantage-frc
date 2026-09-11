import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Storage last snapshot stays on the phone", () => {
  it("reads and writes the storage IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "storage-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"storage"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Storage"/);
    expect(src).not.toMatch(/docs\/STORAGE_NODE\.md/);
    expect(src).not.toMatch(/node server\.mjs/);
    expect(src).toMatch(/fetchFailed && \(view == null \|\| view.status !== "live"\)/);
  });
});
