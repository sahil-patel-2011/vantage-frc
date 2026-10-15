import { describe, expect, it } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import {
  classifyLookupFailure,
  likePattern,
  parseTeamQuery,
  searchTeamsRef,
  teamSearchEmptyCopy,
} from "./team-search";

function fakeClient(rows: unknown[] = []) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    query: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return { rows };
    },
  } as unknown as PoolClient;
  return { client, calls };
}

describe("Research team search", () => {
  it("reads a team number in the ways people type it", () => {
    expect(parseTeamQuery("254")).toEqual({ kind: "number", teamNumber: 254, text: "254" });
    expect(parseTeamQuery(" frc254 ")).toMatchObject({ kind: "number", teamNumber: 254 });
    expect(parseTeamQuery("Team 254")).toMatchObject({ kind: "number", teamNumber: 254 });
    expect(parseTeamQuery("#3091")).toMatchObject({ kind: "number", teamNumber: 3091 });
    expect(parseTeamQuery("Cheesy Poofs")).toEqual({ kind: "text", text: "Cheesy Poofs" });
    expect(parseTeamQuery("0")).toEqual({ kind: "text", text: "0" });
    expect(parseTeamQuery("   ")).toEqual({ kind: "empty" });
  });

  it("takes the user's % and _ literally", () => {
    expect(likePattern("100%_bots")).toBe("%100\\%\\_bots%");
  });

  it("searches all of teams_ref: indexed number match first, then a capped name match", async () => {
    const { client, calls } = fakeClient([{ teamKey: "frc254", teamNumber: 254 }]);
    const rows = await searchTeamsRef(client, "org-1", "254");
    expect(rows).toHaveLength(1);
    expect(calls).toHaveLength(1);
    const { sql, params } = calls[0]!;
    expect(params).toEqual(["org-1", 254, "%254%", 20]);
    expect(sql).toMatch(/t\.team_number = \$2::int/);
    expect(sql).not.toMatch(/team_number::text/);
    expect(sql).toMatch(/ILIKE \$3::text/);
    expect(sql).toMatch(/LIMIT \$4::int/);
    // Not limited to the active event: the event only decides the "At your event" flag.
    expect(sql).toMatch(/FROM teams_ref t\s+WHERE \$2::int IS NOT NULL/);
  });

  it("sends a name search with no number and never queries for an empty box", async () => {
    const { client, calls } = fakeClient();
    await searchTeamsRef(client, "org-1", "poofs", 500);
    expect(calls[0]!.params).toEqual(["org-1", null, "%poofs%", 50]);
    const empty = fakeClient();
    expect(await searchTeamsRef(empty.client, "org-1", "  ")).toEqual([]);
    expect(empty.calls).toHaveLength(0);
  });

  it("says plainly when a team is not in Vantage's list", () => {
    expect(teamSearchEmptyCopy("254")).toMatch(/^Team 254 isn't in Vantage's team list yet\./);
    expect(teamSearchEmptyCopy("poofs")).toMatch(/No team matches "poofs"/);
    expect(teamSearchEmptyCopy("254", { offline: true })).toMatch(/^Offline — Team 254/);
  });

  it("never calls a slow answer offline", () => {
    const timeout = Object.assign(new Error("t"), { name: "TimeoutError" });
    const abort = Object.assign(new Error("a"), { name: "AbortError" });
    const network = new TypeError("Failed to fetch");
    expect(classifyLookupFailure(abort, { superseded: true, online: true })).toBe("superseded");
    expect(classifyLookupFailure(timeout, { superseded: false, online: true })).toBe("timeout");
    expect(classifyLookupFailure(timeout, { superseded: false, online: false })).toBe("timeout");
    expect(classifyLookupFailure(network, { superseded: false, online: false })).toBe("offline");
    expect(classifyLookupFailure(network, { superseded: false, online: true })).toBe("network");
  });
});
