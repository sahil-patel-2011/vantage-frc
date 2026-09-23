import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Event-day plan last snapshot stays on the phone", () => {
  it("reads and writes the event-day-plan IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "event-day-plan-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"event-day-plan"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Event-day plan"/);
  });

  it("uses the planner step on setup and does not fall back to Sync Team Data", () => {
    const src = readFileSync(join(DIR, "event-day-plan-client.tsx"), "utf8");
    expect(src).toMatch(/setupView\?\.steps\[0\]/);
    expect(src).toMatch(/withOrgHref\(step\.href, orgId\)/);
    expect(src).toMatch(/helperStep\.id !== "team-data"/);
    expect(src).toMatch(/emptyTitle=\{setupView\?\.orgId \? setupView\.message : undefined\}/);
  });
});
