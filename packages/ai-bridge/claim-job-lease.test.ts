import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Contract test over `claim_ai_bridge_job`'s lease arithmetic in
 * packages/db/migrations/0488_ai_bridge_full_coverage.sql. plpgsql cannot run in the
 * credential-free unit suite, so this pins the two things that can be checked without a
 * database: that the `timeoutMs` cast is guarded, and that the guard's own pattern —
 * lifted verbatim out of the SQL — classifies queue values the way the lease expects.
 */
const MIGRATION = readFileSync(
  new URL("../db/migrations/0488_ai_bridge_full_coverage.sql", import.meta.url),
  "utf8",
);

/** The `lease := …;` assignment, which is where every timeoutMs read happens. */
function leaseAssignment(): string {
  const match = MIGRATION.match(/lease :=[\s\S]*?;/);
  if (!match) throw new Error("0488 no longer assigns a lease interval");
  return match[0];
}

/** The guard pattern the SQL actually uses, so the cases below cannot drift from it. */
function guardPattern(): RegExp {
  const match = leaseAssignment().match(/~\s*'([^']+)'/);
  if (!match) throw new Error("0488 casts timeoutMs without a regex guard");
  return new RegExp(match[1]!);
}

/** Model of the SQL: GREATEST(2 min, LEAST(secs, 300) + 60), invalid text ⇒ 0. */
function leaseSeconds(timeoutMs: string | null): number {
  const numeric = timeoutMs !== null && guardPattern().test(timeoutMs) ? Number(timeoutMs) : 0;
  return Math.max(120, Math.min(numeric / 1000, 300) + 60);
}

describe("claim_ai_bridge_job lease", () => {
  it("never casts timeoutMs outside the guarded branch", () => {
    const lease = leaseAssignment();
    expect(lease).toContain("::numeric");
    // One malformed row must not raise invalid_text_representation and take the whole
    // org's claim loop down with it, so the cast may only appear after a THEN.
    for (const fragment of lease.split("::numeric").slice(0, -1)) {
      expect(fragment.slice(fragment.lastIndexOf("~"))).toMatch(/~\s*'[^']+'[\s\S]*THEN/);
    }
  });

  it("keeps the 2 minute floor, the 300 s ceiling, and the 60 s reporting margin", () => {
    const lease = leaseAssignment();
    expect(lease).toContain("interval '2 minutes'");
    expect(lease).toMatch(/LEAST\([\s\S]*?,\s*300\)/);
    expect(lease).toContain("+ 60");
  });

  it("falls back to the floor for absent, empty, and malformed values", () => {
    expect(leaseSeconds(null)).toBe(120);
    expect(leaseSeconds("")).toBe(120);
    expect(leaseSeconds("0")).toBe(120);
    expect(leaseSeconds("abc")).toBe(120);
    expect(leaseSeconds("2 minutes")).toBe(120);
    expect(leaseSeconds('{"a":1}')).toBe(120);
    expect(leaseSeconds("-5000")).toBe(120);
  });

  it("grows the lease to the CLI budget plus the reporting margin", () => {
    expect(leaseSeconds("90000")).toBe(150);
    expect(leaseSeconds("240000")).toBe(300);
    expect(leaseSeconds("90000.0")).toBe(150);
    expect(leaseSeconds("9999999")).toBe(360);
  });
});
