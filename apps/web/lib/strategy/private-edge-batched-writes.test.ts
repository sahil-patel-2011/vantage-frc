import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Private Edge runs inside every strategy match view. Its best-effort writes
 * (scout calibrations, CAD↔scout links, pit signals and their alerts) are
 * set-based statements, not one round trip per row.
 */
const SOURCE = readFileSync(join(__dirname, "compute-private-edge.ts"), "utf8");

describe("Private Edge persistence is set-based", () => {
  it("upserts calibrations, CAD links and pit signals with unnest, not per-row loops", () => {
    expect(SOURCE).not.toMatch(/for \(const row of calibrations\)/);
    expect(SOURCE).not.toMatch(/for \(const link of cadLinks\)/);
    expect(SOURCE).not.toMatch(/for \(const signal of view\.pitSignals/);
    expect(SOURCE).toMatch(/INSERT INTO scout_field_reliability[\s\S]*?FROM unnest\(\$3::text\[\], \$4::uuid\[\], \$5::numeric\[\], \$6::int\[\]\)/);
    expect(SOURCE).toMatch(/INSERT INTO cad_scout_links[\s\S]*?FROM unnest\(\$2::uuid\[\], \$3::text\[\]\)/);
    expect(SOURCE).toMatch(/INSERT INTO scout_pit_signals[\s\S]*?FROM unnest\(/);
    expect(SOURCE).toMatch(/INSERT INTO org_live_alerts[\s\S]*?FROM unnest\(/);
  });

  it("keeps each batch conflict-safe exactly as the per-row statements were", () => {
    expect(SOURCE).toMatch(/ON CONFLICT \(org_id, event_key, field_key, scout_user_id\)\s*DO UPDATE/);
    expect(SOURCE).toMatch(/ON CONFLICT \(org_id, subsystem_id, field_key\) DO NOTHING/);
    expect(SOURCE).toMatch(/ON CONFLICT \(org_id, scout_entry_id, signal_kind\) DO NOTHING/);
    expect(SOURCE).toMatch(/ON CONFLICT \(org_id, dedupe_key\) DO NOTHING/);
  });
});
