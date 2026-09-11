import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Batteries last snapshot stays on the phone", () => {
  it("reads and writes the batteries IndexedDB feature cache and does not blank a painted board", () => {
    const client = readFileSync(join(DIR, "batteries-client.tsx"), "utf8");
    const chrome = readFileSync(join(DIR, "batteries-chrome.tsx"), "utf8");
    const src = `${client}\n${chrome}`;
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"batteries"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Batteries"/);
    expect(src).toMatch(/status === 401 \|\| response.status === 403/);
    expect(src).not.toMatch(/fetchFailed \|\| !view/);
    expect(src).not.toMatch(/fetchFailed \|\| view == null/);
  });
});
