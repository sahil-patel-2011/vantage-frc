import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Account last snapshot stays on the phone", () => {
  it("reads and writes the account IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "account-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"account"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Account"/);
  });

  it("keeps one EmptyState primary on a failed load", () => {
    const src = readFileSync(join(DIR, "account-client.tsx"), "utf8");
    expect(src).not.toMatch(/Help & Support/);
    expect(src).not.toMatch(/<NextActions[\s\S]*orgId=\{null\}/);
  });
});
