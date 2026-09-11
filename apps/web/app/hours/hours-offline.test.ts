import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Hours last snapshot stays on the phone", () => {
  it("reads and writes the hours IndexedDB feature cache and does not blank a painted board", () => {
    const client = readFileSync(join(DIR, "hours-client.tsx"), "utf8");
    const chrome = readFileSync(join(DIR, "hours-chrome.tsx"), "utf8");
    const ready = readFileSync(join(DIR, "hours-ready-view.tsx"), "utf8");
    const src = `${client}\n${chrome}\n${ready}`;
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"hours"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Hours"/);
    expect(src).toMatch(/status === 401 \|\| response.status === 403/);
    expect(src).not.toMatch(/fetchFailed \|\| !view/);
    expect(src).not.toMatch(/fetchFailed \|\| view == null/);
  });
});
