import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";

const fake = vi.hoisted(() => ({
  firstOwner: "owner-1" as string | null,
  existingCode: false,
  defaultsFail: false,
  codeFail: false,
  sql: [] as string[],
}));

vi.mock("./defaults", () => ({
  initializeTeamDefaults: vi.fn(async () => {
    if (fake.defaultsFail) throw new Error("new row violates row-level security policy");
  }),
}));
vi.mock("../team/join-code", () => ({
  setTeamJoinCode: vi.fn(async () => {
    if (fake.codeFail) throw new Error("Join codes are unavailable until server authentication is configured.");
    return "123456";
  }),
}));

const { ensureFirstOwnerTeamDefaults } = await import("./owner-defaults");
const { initializeTeamDefaults } = await import("./defaults");
const { setTeamJoinCode } = await import("../team/join-code");

function client(): PoolClient {
  return {
    query: vi.fn(async (sql: string) => {
      fake.sql.push(sql);
      if (sql.includes("FROM memberships")) {
        return { rows: fake.firstOwner ? [{ userId: fake.firstOwner }] : [], rowCount: fake.firstOwner ? 1 : 0 };
      }
      if (sql.includes("FROM team_join_codes")) return { rows: [], rowCount: fake.existingCode ? 1 : 0 };
      return { rows: [], rowCount: 0 };
    }),
  } as unknown as PoolClient;
}

describe("ensureFirstOwnerTeamDefaults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("BETTER_AUTH_SECRET", "owner-defaults-unit-secret");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    Object.assign(fake, { firstOwner: "owner-1", existingCode: false, defaultsFail: false, codeFail: false, sql: [] });
  });

  it("gives an admin-provisioned team the /claim defaults and a join code once its first owner is in", async () => {
    await expect(ensureFirstOwnerTeamDefaults(client(), "org-1", "owner-1")).resolves.toEqual({ defaults: true, joinCode: true });
    expect(initializeTeamDefaults).toHaveBeenCalledWith(expect.anything(), "org-1", { inTransaction: true });
    expect(setTeamJoinCode).toHaveBeenCalledWith(expect.anything(), "org-1");
    // Each part is isolated so a failure never aborts the caller's join.
    expect(fake.sql.filter((sql) => sql.startsWith("SAVEPOINT"))).toHaveLength(2);
  });

  it("changes nothing when someone other than the team's first owner joins", async () => {
    await expect(ensureFirstOwnerTeamDefaults(client(), "org-1", "scout-9")).resolves.toEqual({ defaults: false, joinCode: false });
    fake.firstOwner = null;
    await expect(ensureFirstOwnerTeamDefaults(client(), "org-1", "owner-1")).resolves.toEqual({ defaults: false, joinCode: false });
    expect(initializeTeamDefaults).not.toHaveBeenCalled();
    expect(setTeamJoinCode).not.toHaveBeenCalled();
  });

  it("never replaces a join code the team already has", async () => {
    fake.existingCode = true;
    await expect(ensureFirstOwnerTeamDefaults(client(), "org-1", "owner-1")).resolves.toEqual({ defaults: true, joinCode: false });
    expect(setTeamJoinCode).not.toHaveBeenCalled();
  });

  it("skips the join code quietly when the auth secret is not configured", async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "");
    await expect(ensureFirstOwnerTeamDefaults(client(), "org-1", "owner-1")).resolves.toEqual({ defaults: true, joinCode: false });
    expect(setTeamJoinCode).not.toHaveBeenCalled();
    fake.codeFail = true;
    vi.stubEnv("BETTER_AUTH_SECRET", "configured");
    await expect(ensureFirstOwnerTeamDefaults(client(), "org-1", "owner-1")).resolves.toEqual({ defaults: true, joinCode: false });
  });

  it("rolls back only the defaults when they fail, and still tries the join code", async () => {
    fake.defaultsFail = true;
    const db = client();
    await expect(ensureFirstOwnerTeamDefaults(db, "org-1", "owner-1")).resolves.toEqual({ defaults: false, joinCode: true });
    expect(fake.sql.some((sql) => sql.startsWith("ROLLBACK TO SAVEPOINT"))).toBe(true);
    expect(console.error).toHaveBeenCalledWith("[team-defaults] could not add starter defaults", expect.stringMatching(/row-level security/));
  });
});
