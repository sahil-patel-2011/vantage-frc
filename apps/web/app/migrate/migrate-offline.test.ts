import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Bring your season last snapshot stays on the phone", () => {
  it("reads and writes the migrate IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "migrate-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"migrate"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Bring your season"/);
    expect(src).not.toMatch(/Workspace required/);
    expect(src).not.toMatch(/Notion OAuth/);
    expect(src).not.toMatch(/NOTION_CLIENT_ID/);
    expect(src).not.toMatch(/switching kit/);
  });
});
