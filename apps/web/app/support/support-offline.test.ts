import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Support last snapshot stays on the phone", () => {
  it("reads and writes the support IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "support-tickets-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"support"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Support"/);
    expect(src).not.toMatch(/if \(fetchFailed \|\| view == null\)/);
    expect(src).not.toMatch(/Choose the organization/);
  });

  it("setup keeps one EmptyState primary and no Next-actions wall", () => {
    const src = readFileSync(join(DIR, "support-tickets-client.tsx"), "utf8");
    const setupAt = src.indexOf('if (view.status === "setup_required")');
    expect(setupAt).toBeGreaterThan(0);
    const setup = src.slice(setupAt, src.indexOf("const summary", setupAt));
    expect(setup).not.toMatch(/<NextActions/);
    expect(setup).toMatch(/Choose your team/);
    expect(setup).not.toMatch(/href="\/account"/);
  });
});
