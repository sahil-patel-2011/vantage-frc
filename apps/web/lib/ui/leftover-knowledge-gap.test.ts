import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Knowledge-gap detective chrome after leftover-autopilot.
 * Hub label stays Knowledge gaps. Route /knowledge-gap and cache key stay.
 * Do not invent a last-snapshot.
 */
const FILES = [
  "app/knowledge-gap/knowledge-gap-client.tsx",
  "app/knowledge-gap/page.tsx",
  "app/api/knowledge-gap/route.ts",
  "lib/knowledge-gap/knowledge-gap-related.ts",
  "lib/knowledge-gap/index.ts",
  "lib/manifests/knowledge-gap.manifest.ts",
  "lib/offline/shell-routes.ts",
] as const;

describe("leftover student Knowledge-gap detective chrome", () => {
  it("does not print Knowledge-gap detective on this family", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Knowledge-gap detective/);
      expect(src, rel).not.toMatch(/the detective/);
    }
    const client = readFileSync(join(WEB, "app/knowledge-gap/knowledge-gap-client.tsx"), "utf8");
    expect(client).toMatch(/feature="Knowledge gaps"/);
    expect(client).toMatch(/"knowledge-gap"/);
    const page = readFileSync(join(WEB, "app/knowledge-gap/page.tsx"), "utf8");
    expect(page).toMatch(/title: "Knowledge gaps"/);
  });
});
