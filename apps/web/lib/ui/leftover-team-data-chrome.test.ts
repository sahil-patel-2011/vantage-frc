import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover Team Data student chrome after the marketing TBA pass. Connect TBA
 * and TBA Read API stay the official connector names. Do not invent a
 * last-snapshot.
 */
const STRICT_FILES = [
  "app/team/data/page.tsx",
  "app/api/team/data/route.ts",
  "app/api/context/event/route.ts",
  "app/llms.txt/route.ts",
  "app/llms-full.txt/route.ts",
] as const;

describe("leftover Team Data student TBA chrome", () => {
  it("does not print leftover TBA jargon on Team Data page, APIs, or llms.txt", () => {
    for (const rel of STRICT_FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/TBA\/Statbotics/);
      expect(src, rel).not.toMatch(/\bTBA\b/);
      expect(src, rel).not.toMatch(/Statbotics/);
      expect(src, rel).not.toMatch(/The Blue Alliance/);
      expect(src, rel).not.toMatch(/Season EPA/);
      expect(src, rel).not.toMatch(/Sync TBA/);
    }
  });

  it("Team Data client keeps Connect TBA and drops The Blue Alliance", () => {
    const src = readFileSync(join(WEB, "app/team/data/team-data-client.tsx"), "utf8");
    expect(src).not.toMatch(/The Blue Alliance/);
    expect(src).not.toMatch(/TBA\/Statbotics/);
    expect(src).not.toMatch(/Season EPA/);
    expect(src).not.toMatch(/Sync TBA/);
    expect(src).not.toMatch(/No TBA cache yet/);
    expect(src).not.toMatch(/TBA sync can load/);
    expect(src).not.toMatch(/shared TBA cache/);
    expect(src).not.toMatch(/toUpperCase\(/);
    expect(src).not.toMatch(/Ingestion health/);
    expect(src).not.toMatch(/JSON\.stringify\(health/);
    expect(src).not.toMatch(/health telemetry/);
    expect(src).not.toMatch(/cursor errors/);
    expect(src).toMatch(/Connect TBA/);
    expect(src).toMatch(/TBA Read API/);
    expect(src).toMatch(/degradedModeSourceLabel/);
    expect(src).toMatch(/Official match status/);
  });
});
