import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("AI relays last snapshot stays on the phone", () => {
  it("reads and writes the relays IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "relays-client.tsx"), "utf8");
    expect(src).toMatch(/useOfflineSnapshot/);
    expect(src).toMatch(/"relays"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="AI relays"/);
    expect(src).toMatch(/fetchActiveOrgId/);
    expect(src).toMatch(/Paste this token/);
    expect(src).not.toMatch(/Setup required/);
    expect(src).not.toMatch(/callbackUrl/);
    expect(src).not.toMatch(/fetchFailed \|\| !view/);
    expect(src).not.toMatch(/bookmarklet/i);
    expect(src).not.toMatch(/chrome\.google\.com/);
  });
});
