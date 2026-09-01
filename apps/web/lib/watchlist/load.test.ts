import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { loadWatchlistTeamKeys } from "./load";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[] }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("loadWatchlistTeamKeys", () => {
  it("reads distinct team keys from real opponent_watchlist_entries rows", async () => {
    const client = makeClient((sql, params) => {
      expect(sql).toContain("FROM opponent_watchlist_entries");
      expect(sql).toContain("GROUP BY team_key");
      expect(params[0]).toBe(ORG);
      return {
        rows: [{ teamKey: "frc4414" }, { teamKey: "frc118" }, { teamKey: "frc4414" }],
      };
    });

    await expect(loadWatchlistTeamKeys(client, ORG)).resolves.toEqual(["frc4414", "frc118"]);
  });

  it("degrades to an empty priority list when the watchlist table is missing", async () => {
    const client = makeClient(() => {
      throw new Error('relation "opponent_watchlist_entries" does not exist');
    });

    await expect(loadWatchlistTeamKeys(client, ORG)).resolves.toEqual([]);
  });
});
