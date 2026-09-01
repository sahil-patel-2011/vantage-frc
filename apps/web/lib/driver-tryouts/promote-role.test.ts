import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import {
  promoteSelectedCandidateToSeasonRole,
  rolesApiExists,
  seasonRoleHolderFromCandidate,
  seasonRoleSelectionNotes,
  seasonRoleTitleForTryout,
  shouldPromoteToSeasonRole,
} from "./promote-role";

const USER = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const CANDIDATE = "33333333-3333-4333-8333-333333333333";
const ROLE = "55555555-5555-4555-8555-555555555555";
const SAM = "66666666-6666-4666-8666-666666666666";

type QueryFn = (sql: string, params: unknown[]) => { rows: unknown[]; rowCount: number };

function mockClient(handler: QueryFn): PoolClient {
  return {
    query: vi.fn((sql: string, params: unknown[] = []) => Promise.resolve(handler(sql, params))),
  } as unknown as PoolClient;
}

function installedRolesHandler(options: {
  candidate?: { name: string; roleInterest: string; seasonYear: number } | null;
  roster?: Array<{ userId: string; name: string }>;
  existingRoleId?: string | null;
  holderUserIdColumn?: boolean;
}): QueryFn {
  return (sql) => {
    if (sql.includes("to_regclass")) {
      return { rows: [{ ok: "team_roles" }], rowCount: 1 };
    }
    if (sql.includes("information_schema.columns")) {
      return options.holderUserIdColumn === false
        ? { rows: [], rowCount: 0 }
        : { rows: [{ ok: 1 }], rowCount: 1 };
    }
    if (sql.includes("FROM driver_tryouts_candidates")) {
      if (options.candidate === null) return { rows: [], rowCount: 0 };
      const candidate = options.candidate ?? {
        name: "Sam Rodriguez",
        roleInterest: "driver",
        seasonYear: 2026,
      };
      return {
        rows: [
          {
            id: CANDIDATE,
            name: candidate.name,
            roleInterest: candidate.roleInterest,
            seasonYear: candidate.seasonYear,
          },
        ],
        rowCount: 1,
      };
    }
    if (sql.includes("FROM memberships") && sql.includes("JOIN users")) {
      return {
        rows: options.roster ?? [{ userId: SAM, name: "Sam Rodriguez" }],
        rowCount: (options.roster ?? [{ userId: SAM }]).length,
      };
    }
    if (sql.includes("FROM team_roles") && sql.includes("SELECT id")) {
      return options.existingRoleId
        ? { rows: [{ id: options.existingRoleId }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (sql.includes("INSERT INTO team_roles")) {
      return { rows: [{ id: ROLE }], rowCount: 1 };
    }
    if (sql.includes("UPDATE team_roles")) {
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  };
}

describe("seasonRoleTitleForTryout", () => {
  it("maps each seat to a Season role title — any is Drive team, not Any seat", () => {
    expect(seasonRoleTitleForTryout("driver")).toBe("Driver");
    expect(seasonRoleTitleForTryout("operator")).toBe("Operator");
    expect(seasonRoleTitleForTryout("human_player")).toBe("Human player");
    expect(seasonRoleTitleForTryout("any")).toBe("Drive team");
  });
});

describe("shouldPromoteToSeasonRole", () => {
  it("promotes only selected — cut / active / withdrawn stay off the role map", () => {
    expect(shouldPromoteToSeasonRole("selected")).toBe(true);
    expect(shouldPromoteToSeasonRole("active")).toBe(false);
    expect(shouldPromoteToSeasonRole("cut")).toBe(false);
    expect(shouldPromoteToSeasonRole("withdrawn")).toBe(false);
  });
});

describe("seasonRoleSelectionNotes", () => {
  it("omits averages that were never logged — null and 0 stay off the note", () => {
    expect(seasonRoleSelectionNotes(null)).toBe("Selected from driver tryouts.");
    expect(seasonRoleSelectionNotes(undefined)).toBe("Selected from driver tryouts.");
    expect(seasonRoleSelectionNotes(0)).toBe("Selected from driver tryouts.");
    expect(seasonRoleSelectionNotes(Number.NaN)).toBe("Selected from driver tryouts.");
    expect(seasonRoleSelectionNotes(null)).not.toMatch(/0\/5/);
  });

  it("mentions a real logged average only when it is a 1–5 mean", () => {
    expect(seasonRoleSelectionNotes(4.2)).toBe("Selected from driver tryouts · avg 4.2/5.");
  });
});

describe("seasonRoleHolderFromCandidate", () => {
  const roster = [
    { userId: SAM, name: "Sam Rodriguez" },
    { userId: "u-alex", name: "Alex Rivera" },
  ];

  it("canonicalizes an exact roster match and links the member", () => {
    expect(
      seasonRoleHolderFromCandidate({ name: "  sam  rodriguez ", roleInterest: "driver" }, roster),
    ).toEqual({
      title: "Driver",
      holderName: "Sam Rodriguez",
      holderUserId: SAM,
    });
  });

  it("keeps an unmatched name as typed instead of inventing a member id", () => {
    expect(
      seasonRoleHolderFromCandidate({ name: "Coach Whitaker", roleInterest: "operator" }, roster),
    ).toEqual({
      title: "Operator",
      holderName: "Coach Whitaker",
      holderUserId: null,
    });
  });

  it("leaves a blank name unfilled rather than writing an empty holder", () => {
    expect(seasonRoleHolderFromCandidate({ name: "   ", roleInterest: "driver" }, roster)).toEqual({
      title: "Driver",
      holderName: null,
      holderUserId: null,
    });
  });
});

describe("rolesApiExists", () => {
  it("is false when team_roles is not installed", async () => {
    const client = mockClient((sql) =>
      sql.includes("to_regclass")
        ? { rows: [{ ok: null }], rowCount: 1 }
        : { rows: [], rowCount: 0 },
    );
    expect(await rolesApiExists(client)).toBe(false);
  });

  it("is true when to_regclass returns the table", async () => {
    const client = mockClient((sql) =>
      sql.includes("to_regclass")
        ? { rows: [{ ok: "team_roles" }], rowCount: 1 }
        : { rows: [], rowCount: 0 },
    );
    expect(await rolesApiExists(client)).toBe(true);
  });
});

describe("promoteSelectedCandidateToSeasonRole", () => {
  const baseInput = {
    orgId: ORG,
    userId: USER,
    candidateId: CANDIDATE,
    status: "selected" as const,
    seasonYear: 2026,
  };

  it("skips without touching team_roles when status is not selected", async () => {
    const client = mockClient(() => ({ rows: [], rowCount: 0 }));
    const result = await promoteSelectedCandidateToSeasonRole(client, {
      ...baseInput,
      status: "cut",
    });
    expect(result).toEqual({ status: "skipped", reason: "not_selected" });
    expect(client.query).not.toHaveBeenCalled();
  });

  it("skips when the roles table is absent — status write must still succeed", async () => {
    const client = mockClient((sql) =>
      sql.includes("to_regclass")
        ? { rows: [{ ok: null }], rowCount: 1 }
        : { rows: [], rowCount: 0 },
    );
    const result = await promoteSelectedCandidateToSeasonRole(client, baseInput);
    expect(result).toEqual({ status: "skipped", reason: "roles_unavailable" });
    const sql = vi.mocked(client.query).mock.calls.map((call) => String(call[0]));
    expect(sql.some((text) => text.includes("INSERT INTO team_roles"))).toBe(false);
    expect(sql.some((text) => text.includes("UPDATE team_roles"))).toBe(false);
  });

  it("skips when the candidate row is gone", async () => {
    const client = mockClient(installedRolesHandler({ candidate: null }));
    const result = await promoteSelectedCandidateToSeasonRole(client, baseInput);
    expect(result).toEqual({ status: "skipped", reason: "candidate_missing" });
  });

  it("skips an empty candidate name instead of writing a blank holder", async () => {
    const client = mockClient(
      installedRolesHandler({ candidate: { name: "  ", roleInterest: "driver", seasonYear: 2026 } }),
    );
    const result = await promoteSelectedCandidateToSeasonRole(client, baseInput);
    expect(result).toEqual({ status: "skipped", reason: "empty_name" });
    const sql = vi.mocked(client.query).mock.calls.map((call) => String(call[0]));
    expect(sql.some((text) => text.includes("INSERT INTO team_roles"))).toBe(false);
  });

  it("inserts a drive_team Driver holder when no matching Season role exists", async () => {
    const client = mockClient(installedRolesHandler({}));
    const result = await promoteSelectedCandidateToSeasonRole(client, baseInput);
    expect(result).toEqual({
      status: "created",
      roleId: ROLE,
      title: "Driver",
      holderName: "Sam Rodriguez",
      holderUserId: SAM,
    });
    const insert = vi.mocked(client.query).mock.calls.find((call) =>
      String(call[0]).includes("INSERT INTO team_roles"),
    );
    expect(insert).toBeTruthy();
    expect(insert![1]).toEqual([
      ORG,
      2026,
      "Driver",
      "drive_team",
      "Sam Rodriguez",
      SAM,
      "Driver seat filled from driver tryouts.",
      "Selected from driver tryouts.",
      USER,
    ]);
    expect(JSON.stringify(insert![1])).not.toMatch(/avg 0/);
  });

  it("updates the existing unfilled seat instead of inserting a second Driver role", async () => {
    const client = mockClient(installedRolesHandler({ existingRoleId: ROLE }));
    const result = await promoteSelectedCandidateToSeasonRole(client, baseInput);
    expect(result).toEqual({
      status: "updated",
      roleId: ROLE,
      title: "Driver",
      holderName: "Sam Rodriguez",
      holderUserId: SAM,
    });
    const update = vi.mocked(client.query).mock.calls.find((call) =>
      String(call[0]).includes("UPDATE team_roles"),
    );
    expect(update![1]).toEqual([ROLE, ORG, "Sam Rodriguez", SAM]);
    const sql = vi.mocked(client.query).mock.calls.map((call) => String(call[0]));
    expect(sql.some((text) => text.includes("INSERT INTO team_roles"))).toBe(false);
  });

  it("writes holder_name only when holder_user_id has not been migrated yet", async () => {
    const client = mockClient(installedRolesHandler({ holderUserIdColumn: false }));
    const result = await promoteSelectedCandidateToSeasonRole(client, baseInput);
    expect(result.status).toBe("created");
    if (result.status === "created") expect(result.holderUserId).toBeNull();
    const insert = vi.mocked(client.query).mock.calls.find((call) =>
      String(call[0]).includes("INSERT INTO team_roles"),
    );
    expect(String(insert![0])).not.toMatch(/holder_user_id/);
    expect(insert![1]).toEqual([
      ORG,
      2026,
      "Driver",
      "drive_team",
      "Sam Rodriguez",
      "Driver seat filled from driver tryouts.",
      "Selected from driver tryouts.",
      USER,
    ]);
  });

  it("stores an unmatched candidate name without inventing a member id", async () => {
    const client = mockClient(
      installedRolesHandler({
        candidate: { name: "Coach Whitaker", roleInterest: "human_player", seasonYear: 2026 },
        roster: [{ userId: SAM, name: "Sam Rodriguez" }],
      }),
    );
    const result = await promoteSelectedCandidateToSeasonRole(client, baseInput);
    expect(result).toMatchObject({
      status: "created",
      title: "Human player",
      holderName: "Coach Whitaker",
      holderUserId: null,
    });
  });

  it("never writes a 0 average into notes when overallAverage is missing or zero", async () => {
    const client = mockClient(installedRolesHandler({}));
    await promoteSelectedCandidateToSeasonRole(client, { ...baseInput, overallAverage: 0 });
    const insert = vi.mocked(client.query).mock.calls.find((call) =>
      String(call[0]).includes("INSERT INTO team_roles"),
    );
    expect(insert![1]).toContain("Selected from driver tryouts.");
    expect(insert![1]).not.toContain("Selected from driver tryouts · avg 0/5.");
  });
});
