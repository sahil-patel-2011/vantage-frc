import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import {
  isScoutForbidden,
  resolveScoutOrg,
  ScoutForbiddenError,
  scoutForbiddenResponse,
} from "./scout-org-access";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER = "11111111-1111-4111-8111-111111111111";

function mockClient(rowCount: number, rows: unknown[] = []): PoolClient {
  return {
    query: vi.fn().mockResolvedValue({ rowCount, rows }),
  } as unknown as PoolClient;
}

describe("SECURITY — scout resolveScoutOrg wrong orgId → 403", () => {
  it("throws ScoutForbiddenError when an explicit foreign orgId has no membership", async () => {
    const client = mockClient(0);
    await expect(resolveScoutOrg(client, USER, ORG_B)).rejects.toMatchObject({
      name: "ScoutForbiddenError",
      status: 403,
      message: "forbidden",
    });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("m.org_id = $2::uuid"),
      [USER, ORG_B],
    );
  });

  it("returns the org when the caller is a member", async () => {
    const client = mockClient(1, [{ orgId: ORG_A, teamNumber: 254, role: "scout" }]);
    await expect(resolveScoutOrg(client, USER, ORG_A)).resolves.toEqual({
      orgId: ORG_A,
      teamNumber: 254,
      role: "scout",
    });
  });

  it("returns null (setup_required path) when no orgId is requested and user has no orgs", async () => {
    const client = mockClient(0);
    await expect(resolveScoutOrg(client, USER, null)).resolves.toBeNull();
  });

  it("isScoutForbidden recognizes route and compute denials", () => {
    expect(isScoutForbidden(new ScoutForbiddenError())).toBe(true);
    expect(isScoutForbidden(new Error("forbidden"))).toBe(true);
    expect(isScoutForbidden(new Error("Organization access denied"))).toBe(true);
    expect(isScoutForbidden(new Error("thinThreshold must be a positive integer"))).toBe(false);
  });

  it("scoutForbiddenResponse returns HTTP 403", async () => {
    const response = scoutForbiddenResponse();
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Organization access denied" });
  });
});
