import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Control Map last snapshot stays on the phone", () => {
  it("reads and writes the control-map IndexedDB feature cache", () => {
    const src = [
      readFileSync(join(DIR, "control-map-client.tsx"), "utf8"),
      readFileSync(join(DIR, "../api/control-map/route.ts"), "utf8"),
    ].join("\n");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"control-map"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Control Map"/);
    expect(src).toContain('href="/#waitlist"');
    expect(src).toMatch(/persistOrgIdInUrl/);
    expect(src).toMatch(/join the waitlist/i);
  });
});
