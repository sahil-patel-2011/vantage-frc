import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student OAuth / org_id / Onshape workspace chrome on Exports,
 * CAD Change Radar, and CAD learn. Identifiers stay. leftover-cad-change-radar
 * extras stay. leftover-hub-titles Change radar extras stay. leftover-fmea-boards
 * extras stay. leftover-offline extras and leftover-hub extras stay off leftover-
 * cad-change-radar FILES — do not gold leftover-hub + leftover-offline pairs
 * together. Do not invent a last-snapshot.
 */
const FILES = [
  "app/exports/export-client.tsx",
  "app/cad-change-radar/cad-change-radar-client.tsx",
  "lib/cad-change-radar/compute-cad-change-radar.ts",
  "lib/cad-change-radar/cad-change-radar-related.ts",
  "lib/cad-learn/track.ts",
] as const;

describe("leftover student export OAuth and Onshape workspace chrome", () => {
  it("does not print leftover OAuth, org_id, or Onshape workspace on this family", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/\bOAuth\b/);
      expect(src, rel).not.toMatch(/org_id isolation/);
      expect(src, rel).not.toMatch(/RFC 4180/);
      expect(src, rel).not.toMatch(/Onshape workspace/);
    }
    const exports = readFileSync(join(WEB, "app/exports/export-client.tsx"), "utf8");
    expect(exports).toMatch(/sign-in tokens/);
    expect(exports).toMatch(/Other teams' work/);
    const radar = readFileSync(join(WEB, "app/cad-change-radar/cad-change-radar-client.tsx"), "utf8");
    expect(radar).toMatch(/Onshape document/);
  });
});
