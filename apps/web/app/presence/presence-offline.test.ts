import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Presence last snapshot stays on the phone", () => {
  it("reads and writes the presence IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "presence-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"presence"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Presence"/);
    expect(src).not.toMatch(/if \(fetchFailed \|\| view == null\)/);
  });
});
