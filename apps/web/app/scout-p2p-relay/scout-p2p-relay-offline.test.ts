import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Pit link last snapshot stays on the phone", () => {
  it("reads and writes the scout-p2p-relay IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "scout-p2p-relay-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"scout-p2p-relay"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Pit link"/);
  });
});
