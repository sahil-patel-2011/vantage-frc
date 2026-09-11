import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Bring-up last snapshot stays on the phone", () => {
  it("reads and writes the bringup IndexedDB feature cache and does not blank a painted board", () => {
    const src = readFileSync(join(DIR, "bringup-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"bringup"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Bring-up"/);
    expect(src).toMatch(/viewRef/);
    expect(src).toMatch(/AbortSignal\.timeout/);
    expect(src).toMatch(/response\.status === 401 \|\| response\.status === 403/);
    expect(src).toMatch(/if \(!view\)/);
    expect(src).toMatch(/data satisfies never/);
    expect(src).not.toMatch(/fetchFailed \|\| !view/);
    expect(src).not.toMatch(/fetchFailed \|\| view == null/);
    expect(src).not.toMatch(/VANTAGE \/ BRING-UP/);
  });
});
