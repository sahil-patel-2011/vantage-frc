import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Object chat last snapshot stays on the phone", () => {
  it("reads and writes the object-chat-bridge IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "object-chat-bridge-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"object-chat-bridge"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Object chat"/);
  });
});
