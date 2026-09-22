import { describe, expect, it } from "vitest";
import { listOrgHubAccessByUser, sponsorsUiAllowed } from "./hub-access";

describe("sponsorsUiAllowed", () => {
  it("treats null/undefined as allowed (legacy orgs)", () => {
    expect(sponsorsUiAllowed({ sponsorsAllowed: null })).toBe(true);
    expect(sponsorsUiAllowed({ sponsorsAllowed: undefined as unknown as null })).toBe(true);
  });

  it("hides sponsor Soft-UI when funding profile sets false", () => {
    expect(sponsorsUiAllowed({ sponsorsAllowed: false })).toBe(false);
    expect(sponsorsUiAllowed({ sponsorsAllowed: true })).toBe(true);
  });
});

describe("listOrgHubAccessByUser", () => {
  it("returns an entry for every member (empty = unrestricted) from one query", async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const client = {
      query: async (sql: string, params: unknown[]) => {
        calls.push({ sql, params });
        return {
          rows: [
            { userId: "u1", hubId: "build", allowedTabIds: ["parts"] },
            { userId: "u1", hubId: "team", allowedTabIds: null },
            { userId: "u2", hubId: "not-a-hub", allowedTabIds: [] },
          ],
        };
      },
    };
    const result = await listOrgHubAccessByUser(client as never, "org", ["u1", "u2", "u3", "u1"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.sql).toMatch(/user_id = ANY\(\$2::uuid\[\]\)/);
    expect(calls[0]!.params).toEqual(["org", ["u1", "u2", "u3"]]);
    expect(result).toEqual({
      u1: [
        { hubId: "build", allowedTabIds: ["parts"] },
        { hubId: "team", allowedTabIds: [] },
      ],
      u2: [],
      u3: [],
    });
  });

  it("skips the query when there are no members", async () => {
    const client = { query: async () => { throw new Error("should not query"); } };
    expect(await listOrgHubAccessByUser(client as never, "org", [])).toEqual({});
  });
});
