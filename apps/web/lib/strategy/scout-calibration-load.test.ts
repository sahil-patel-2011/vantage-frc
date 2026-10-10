import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { loadScoutCalibrations } from "./scout-calibration-load";

const orgId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const eventKey = "2026txho";
describe("scout calibration evidence", () => {
  it("uses tenant-matched robot checks and excludes unavailable checks and soft predictions from its denominator", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [
      { scoutUserId: "11111111-1111-4111-8111-111111111111", fieldKey: "endgame", agreementRate: 0.75, nSamples: 4 },
    ] });
    const result = await loadScoutCalibrations({ query } as unknown as PoolClient, orgId, eventKey);
    const [sql, params] = query.mock.calls[0]!;
    expect(params).toEqual([orgId, eventKey]);
    expect(sql).toContain("FROM scout_entry_validations v");
    expect(sql).toContain("e.org_id=v.org_id");
    expect(sql).toContain("v.official_source='tba'");
    expect(sql).toContain("[robot-check-v3]");
    expect(sql).toContain("p.schema_id=e.schema_id AND p.field_key=v.field_key AND NOT p.enabled");
    expect(sql).toContain("WHERE v.status IN ('match','conflict')");
    expect(sql).not.toContain("scout_crossval");
    expect(result).toEqual([{ scoutUserId: "11111111-1111-4111-8111-111111111111", fieldKey: "endgame", agreementRate: 0.75, nSamples: 4 }]);
  });
  it("keeps absent evidence absent instead of inventing a confidence score", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ scoutUserId: "someone", fieldKey: "climb", agreementRate: null, nSamples: 0 }] });
    expect(await loadScoutCalibrations({ query } as unknown as PoolClient, orgId, eventKey)).toEqual([]);
  });
});
