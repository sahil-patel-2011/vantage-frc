import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { loadTeamProfiles } from "./team-profiles";
describe("robot capabilities without scoring formulas", () => {
  it("retains original reports when counts cannot honestly be converted to points", async () => {
    const entry = {
      teamKey: "frc254",
      matchKey: "2026a_qm1",
      payload: { cycles: 6 },
      confidence: "normal",
      fields: [{ key: "cycles", label: "Cycles", type: "counter" }],
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [entry] })
      .mockResolvedValueOnce({ rows: [] });
    const result = await loadTeamProfiles({ query } as unknown as PoolClient, {
      orgId: "org",
      eventKey: "2026a",
    });
    expect(result.status).toBe("needs_formula");
    if (result.status !== "needs_formula")
      throw new Error("expected an unavailable score, with raw observations");
    expect(result.observations).toEqual([
      {
        teamKey: "frc254",
        reports: [
          {
            matchKey: entry.matchKey,
            eventKey: "2026a",
            payload: entry.payload,
            confidence: "normal",
            fields: entry.fields,
          },
        ],
      },
    ]);
  });
});
