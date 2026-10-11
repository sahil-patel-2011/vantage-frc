import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Scout forms last snapshot stays on the phone", () => {
  it("reads and writes the scout-forms IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "forms-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"scout-forms"/);
    // Reads get scouting's 20-second wait; a publish (a write) gets 30 seconds and a read-back
    // when no answer comes (lib/scouting/publish-confirm.ts).
    expect(src).toMatch(/AbortSignal\.timeout\(SCOUTING_LOAD_TIMEOUT_MS\)/);
    expect(src).toMatch(/AbortSignal\.timeout\(PUBLISH_TIMEOUT_MS\)/);
    expect(src).toMatch(/publishOutcomeAfterTimeout/);
    expect(src).toMatch(/feature="Scout forms"/);
    expect(src).toMatch(/AbortSignal\.timeout/);
    // The error shell shows only when this team's load failed with nothing cached; a stale
    // error from the previously selected team must not replace the new team's forms.
    expect(src).toMatch(/if \(loadedOrg === orgId && loadError && !payload\)/);
    expect(src).not.toMatch(/fetchFailed \|\| !view/);
    expect(src).not.toMatch(/fetchFailed \|\| view == null/);
  });
});
