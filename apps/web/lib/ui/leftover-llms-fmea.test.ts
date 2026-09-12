import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover public llms.txt / CAD feature chrome after the L×I / FMEA chip
 * gold. Route id `fmea` stays. Connect TBA stays off this family. Do not
 * invent a last-snapshot.
 */
const FILES = [
  "app/llms.txt/route.ts",
  "app/llms-full.txt/route.ts",
  "app/features/cad/page.tsx",
] as const;

describe("leftover public llms / CAD feature FMEA and OAuth chrome", () => {
  it("does not print leftover FMEA or Onshape OAuth on this family", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/\bFMEA\b/);
      expect(src, rel).not.toMatch(/Onshape OAuth/);
      expect(src, rel).not.toMatch(/hosted OAuth/);
      expect(src, rel).not.toMatch(/setup required/i);
    }
    const llms = readFileSync(join(WEB, "app/llms.txt/route.ts"), "utf8");
    expect(llms).toMatch(/Failure log/);
    const full = readFileSync(join(WEB, "app/llms-full.txt/route.ts"), "utf8");
    expect(full).toMatch(/Failure log/);
    expect(full).toMatch(/Connect Onshape/);
    const cad = readFileSync(join(WEB, "app/features/cad/page.tsx"), "utf8");
    expect(cad).toMatch(/Connect Onshape/);
  });
});
