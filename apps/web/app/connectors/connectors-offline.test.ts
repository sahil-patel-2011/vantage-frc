import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Connectors last snapshot stays on the phone", () => {
  it("reads and writes the connectors IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "connectors-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"connectors"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Connectors"/);
    expect(src).toMatch(/hadCache \|\| viewRef\.current/);
    expect(src).toMatch(/Choose your team/);
    expect(src).toMatch(/CadDocumentPicker/);
    expect(src).not.toMatch(/fetchFailed \|\| !view/);
    expect(src).not.toMatch(/CLIENT_SECRET|Onshape OAuth/);
  });
});
