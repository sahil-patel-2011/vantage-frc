import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Assembly manual last snapshot stays on the phone", () => {
  it("reads and writes the assembly-manual IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "assembly-manual-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"assembly-manual"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Assembly manual"/);
  });

  it("paste Onshape + Connect Onshape is the primary start path", () => {
    const src = readFileSync(join(DIR, "assembly-manual-client.tsx"), "utf8");
    const chrome = readFileSync(join(DIR, "assembly-manual-chrome.tsx"), "utf8");
    expect(src).toMatch(/Paste an Onshape assembly link and Connect Onshape/);
    expect(src).toMatch(/Onshape assembly link/);
    expect(src).toMatch(/ConnectOnshapeCard/);
    expect(src).toMatch(/FUSION_CANNOT_FEED_BOOK/);
    expect(src).toMatch(/Waiting for a worker to check in/);
    expect(src).toMatch(/documentId/);
    expect(chrome).toMatch(/Choose your team/);
    expect(chrome).toMatch(/Needs setup/);
    expect(chrome).toMatch(/CONNECT_ONSHAPE/);
    expect(src).not.toMatch(/shop Pi/);
  });
});
