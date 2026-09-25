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
    const start = src.indexOf("fetchFailed && !account");
    // Just the failed-load block; the help card (with its Support row) sits later on the page.
    const fail = src.slice(start, src.indexOf("{account ? (", start));
    expect(fail).not.toMatch(/href="\/support"/);
    expect(src).not.toMatch(/<NextActions[\s\S]*orgId=\{null\}/);
  });
});
