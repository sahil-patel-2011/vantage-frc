import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Leadership Continuity last snapshot stays on the phone", () => {
  it("reads and writes the leadership IndexedDB feature cache and does not blank a painted board", () => {
    const src = readFileSync(join(DIR, "leadership-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"leadership"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Leadership Continuity"/);
    expect(src).toMatch(/viewRef/);
    expect(src).toMatch(/AbortSignal\.timeout/);
    expect(src).toMatch(/response\.status === 401 \|\| response\.status === 403/);
    expect(src).toMatch(/if \(!view\)/);
    expect(src).toMatch(/data satisfies never/);
    expect(src).toMatch(/not a recorded team goal/);
    expect(src).not.toMatch(/if \(fetchFailed\) \{/);
    expect(src).not.toMatch(/fetchFailed \|\| !view/);
    expect(src).not.toMatch(/fetchFailed \|\| view == null/);
  });
});
