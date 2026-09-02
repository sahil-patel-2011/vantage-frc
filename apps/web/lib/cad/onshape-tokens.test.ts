import type { PoolClient } from "@neondatabase/serverless";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Only the crypto + refresh seams are mocked; everything else (OAuth config
// parsing, API-key detection, the SQL) is the real module.
vi.mock("@vantage/billing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vantage/billing")>();
  return {
    ...actual,
    createKms: vi.fn(() => ({ kind: "test-kms" })),
    decryptSecret: vi.fn(async () =>
      JSON.stringify({ accessToken: "stale", refreshToken: "refresh-1", expiresAt: Date.now() - 1_000, tokenType: "Bearer" }),
    ),
    encryptSecret: vi.fn(async (plaintext: string) => ({ ciphertext: `enc(${plaintext})` })),
  };
});
vi.mock("@vantage/cad", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vantage/cad")>();
  return {
    ...actual,
    refreshOnshapeToken: vi.fn(async () => ({
      accessToken: "fresh",
      refreshToken: "refresh-2",
      expiresAt: Date.now() + 3_600_000,
      tokenType: "Bearer",
    })),
  };
});

import { refreshOnshapeToken } from "@vantage/cad";
import { findOnshapeConnection, loadCadAgentOnshape, onshapeAvailability, persistRotatedOnshapeTokens } from "./onshape-tokens";

function makeClient(rows: unknown[]): PoolClient & { calls: Array<{ sql: string; params: unknown[] }> } {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  return {
    calls,
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return { rows, rowCount: rows.length };
    }),
  } as unknown as PoolClient & { calls: Array<{ sql: string; params: unknown[] }> };
}

const ENV_KEYS = [
  "ONSHAPE_OAUTH_CLIENT_ID",
  "ONSHAPE_OAUTH_CLIENT_SECRET",
  "ONSHAPE_ACCESS_KEY",
  "ONSHAPE_SECRET_KEY",
  "ONSHAPE_API_KEY",
  "ONSHAPE_API_SECRET",
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});
afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("findOnshapeConnection", () => {
  it("asks for the caller's row before the team row and only connected, enabled ones", async () => {
    const client = makeClient([{ id: "c1", encrypted_credentials: "{}", user_id: "u1", label: "Onshape OAuth" }]);
    const row = await findOnshapeConnection(client, "org-1", "u1");
    expect(row?.id).toBe("c1");
    const call = client.calls[0]!;
    expect(call.sql).toMatch(/user_id=\$2::uuid OR user_id IS NULL/);
    expect(call.sql).toMatch(/ORDER BY \(user_id IS NULL\) ASC/);
    expect(call.sql).toMatch(/status='connected' AND disabled_at IS NULL/);
    expect(call.params).toEqual(["org-1", "u1"]);
  });
});

describe("onshapeAvailability", () => {
  it("is neither configured nor connected with no env and no rows", async () => {
    const result = await onshapeAvailability(makeClient([]), "org-1", "u1");
    expect(result).toEqual({ configured: false, connected: false, via: null, team: false });
  });

  it("reports the team row as team_oauth when OAuth env is set", async () => {
    process.env.ONSHAPE_OAUTH_CLIENT_ID = "cid";
    process.env.ONSHAPE_OAUTH_CLIENT_SECRET = "secret";
    const client = makeClient([{ id: "team", encrypted_credentials: "{}", user_id: null, label: "Onshape (shared with team)" }]);
    const result = await onshapeAvailability(client, "org-1", "u1");
    expect(result).toMatchObject({ configured: true, connected: true, via: "team_oauth", team: true });
  });

  it("reports a personal row as oauth", async () => {
    process.env.ONSHAPE_OAUTH_CLIENT_ID = "cid";
    process.env.ONSHAPE_OAUTH_CLIENT_SECRET = "secret";
    const client = makeClient([{ id: "mine", encrypted_credentials: "{}", user_id: "u1", label: "Onshape OAuth" }]);
    expect(await onshapeAvailability(client, "org-1", "u1")).toMatchObject({ via: "oauth", team: false });
  });

  it("does not count a stored row when the OAuth client is missing, but falls back to server API keys", async () => {
    const client = makeClient([{ id: "mine", encrypted_credentials: "{}", user_id: "u1", label: "Onshape OAuth" }]);
    expect(await onshapeAvailability(client, "org-1", "u1")).toMatchObject({ configured: false, connected: false, via: null });
    process.env.ONSHAPE_ACCESS_KEY = "ak";
    process.env.ONSHAPE_SECRET_KEY = "sk";
    expect(await onshapeAvailability(client, "org-1", "u1")).toMatchObject({ configured: true, connected: true, via: "api_key" });
  });
});

describe("token rotation on shared rows", () => {
  it("persists a refresh through rotate_cad_connection_credentials() so members and the sharer's copy stay in sync", async () => {
    process.env.ONSHAPE_OAUTH_CLIENT_ID = "cid";
    process.env.ONSHAPE_OAUTH_CLIENT_SECRET = "secret";
    const client = makeClient([{ id: "team-row", encrypted_credentials: JSON.stringify({ ciphertext: "old" }), user_id: null, label: "Onshape (shared with team)" }]);
    (client.query as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (sql: string, params: unknown[] = []) => {
      client.calls.push({ sql, params });
      if (/rotate_cad_connection_credentials/.test(sql)) return { rows: [{ touched: 2 }], rowCount: 1 };
      return { rows: [{ id: "team-row", encrypted_credentials: JSON.stringify({ ciphertext: "old" }), user_id: null, label: "Onshape (shared with team)" }], rowCount: 1 };
    });

    const onshape = await loadCadAgentOnshape(client, "org-1", "member-1");

    expect(onshape.via).toBe("team_oauth");
    expect(onshape.connectionId).toBe("team-row");
    expect(refreshOnshapeToken).toHaveBeenCalledWith(expect.objectContaining({ clientId: "cid" }), "refresh-1");
    const rotate = client.calls.find((call) => /rotate_cad_connection_credentials/.test(call.sql));
    expect(rotate).toBeDefined();
    expect(rotate!.sql).toMatch(/SELECT rotate_cad_connection_credentials\(\$1::uuid, \$2\)/);
    expect(rotate!.params[0]).toBe("team-row");
    // The blob stored is the encrypted NEW token set, never the stale one.
    expect(String(rotate!.params[1])).toContain("refresh-2");
    expect(String(rotate!.params[1])).not.toContain("refresh-1");
    // No direct UPDATE cad_connections — RLS would silently drop it for a member.
    expect(client.calls.some((call) => /UPDATE cad_connections/.test(call.sql))).toBe(false);
  });

  it("reports how many copies of the grant were updated", async () => {
    const client = makeClient([{ touched: 2 }]);
    const touched = await persistRotatedOnshapeTokens(client, "row-1", {
      accessToken: "a",
      refreshToken: "r",
      expiresAt: Date.now() + 1_000,
    });
    expect(touched).toBe(2);
    expect(client.calls[0]!.params[0]).toBe("row-1");
  });
});
