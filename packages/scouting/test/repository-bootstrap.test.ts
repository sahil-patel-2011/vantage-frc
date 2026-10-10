import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { ScoutingRepository } from "../src/repository";
vi.mock("../src/permissions", () => ({ canManageScouting: async () => false, assertScoutingLead: vi.fn() }));

describe("scouting bootstrap linked event", () => {
  it("reads assignments, schemas and reports in the explicit event without reading or changing active context", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM users")) return { rows: [{ name: "Scout", email: "scout@example.com" }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const result = await new ScoutingRepository({ query } as unknown as PoolClient).bootstrap("team", "scout", { eventKey: "2026txho", eventName: null });
    expect(result.eventKey).toBe("2026txho"); expect(result.eventName).toBeNull();
    expect(query.mock.calls.some(([sql]) => String(sql).includes("org_active_context"))).toBe(false);
    expect(query.mock.calls.some(([sql]) => /UPDATE|INSERT|DELETE/.test(String(sql)))).toBe(false);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("FROM scout_schemas"), ["team", "2026txho"]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("FROM scout_assignments"), ["team", "scout", "2026txho"]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("FROM match_scout_entries"), ["team", "2026txho"]);
  });
});
