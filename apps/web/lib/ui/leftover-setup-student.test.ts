import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Skip-list boards may still say Setup required (admin, display, audit,
 * posture, and the multi-fetch code-client shell). Student product boards
 * say Needs setup.
 */
const SKIP = [
  "app/admin/",
  "app/display/",
  "app/team/audit/",
  "app/team/posture/",
  "app/team/sponsors/",
  "app/team/finance/",
  "app/team/security/",
  "app/code/code-client.tsx",
];

function collect(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...collect(full));
      continue;
    }
    if (!name.endsWith(".tsx") && !name.endsWith(".ts")) continue;
    if (name.endsWith(".test.ts") || name.endsWith(".test.tsx")) continue;
    out.push(full);
  }
  return out;
}

function isSkip(rel: string): boolean {
  return SKIP.some((prefix) => rel === prefix.replace(/\/$/, "") || rel.startsWith(prefix));
}

describe("student boards do not print Setup required", () => {
  it("app clients and pages outside the skip-list say Needs setup", () => {
    const files = collect(join(WEB, "app")).filter((file) => {
      const rel = relative(WEB, file).replace(/\\/g, "/");
      return !isSkip(rel);
    });
    const leftover = files.flatMap((file) => {
      const rel = relative(WEB, file).replace(/\\/g, "/");
      const src = readFileSync(file, "utf8");
      if (!src.includes("Setup required")) return [];
      return [rel];
    });
    expect(leftover, leftover.join("\n")).toEqual([]);
  });
});
