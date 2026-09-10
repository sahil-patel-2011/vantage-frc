/**
 * Feature folders under apps/web/lib may import @vantage/* and shared helpers,
 * not another feature's internals. This is the modular-monolith rule the
 * tenancy model depends on: one withRls chokepoint, not a web of hidden
 * cross-feature SQL.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const LIB = join(__dirname, "..");

const FEATURE_DIRS = [
  "dashboard",
  "offline",
  "connectors",
  "drive",
  "onboarding",
  "workspace",
  "account",
  "invite",
  "help",
  "season-calendar.ts",
  "packing.ts",
  "bugbot",
  "business",
  "cad-vault",
] as const;

const SHARED_PREFIXES = [
  "nav/",
  "ui/",
  "security/",
  "help/",
  "legal",
  "rate-limit",
  "home-workflows",
  "reference",
  "reference-health",
  "db-error",
  "tenant-org-access",
  "storage-node",
  "storage-routing",
  "perf/",
];

function filesUnder(abs: string, acc: string[] = []): string[] {
  let stats;
  try {
    stats = statSync(abs);
  } catch {
    return acc;
  }
  if (stats.isFile()) {
    if (/\.tsx?$/.test(abs) && !abs.endsWith(".test.ts") && !abs.endsWith(".test.tsx")) acc.push(abs);
    return acc;
  }
  if (!stats.isDirectory()) return acc;
  for (const entry of readdirSync(abs)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    filesUnder(join(abs, entry), acc);
  }
  return acc;
}

function isShared(spec: string): boolean {
  if (spec.startsWith("@vantage/")) return true;
  if (!spec.includes("/lib/") && !spec.startsWith(".")) return true;
  return SHARED_PREFIXES.some((prefix) => spec.includes(`/lib/${prefix}`) || spec.endsWith(`/lib/${prefix.replace(/\/$/, "")}`));
}

describe("module boundaries", () => {
  it("keeps dashboard / offline / connectors / drive from importing another feature folder", () => {
    const offenders: string[] = [];
    for (const feature of FEATURE_DIRS) {
      const root = join(LIB, feature);
      for (const file of filesUnder(root)) {
        const text = readFileSync(file, "utf8");
        const imports = [...text.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]!);
        for (const spec of imports) {
          if (!spec.startsWith(".")) continue;
          const resolved = join(file, "..", spec);
          const rel = relative(LIB, resolved).split(sep).join("/");
          const other = FEATURE_DIRS.find((candidate) => {
            if (candidate === feature) return false;
            const dir = candidate.replace(/\.ts$/, "");
            return rel === candidate || rel === dir || rel.startsWith(`${dir}/`);
          });
          if (other && !isShared(spec)) {
            offenders.push(`${relative(LIB, file)} → ${spec} (${other})`);
          }
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
