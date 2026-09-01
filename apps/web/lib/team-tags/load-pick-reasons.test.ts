import { describe, expect, it } from "vitest";
import { loadTeamTagAssignments, loadTeamTagPickReasons } from "./load-pick-reasons";

type QueryHandler = (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }>;

function clientWith(query: QueryHandler) {
  return { query } as never;
}

const orgId = "11111111-1111-1111-1111-111111111111";

describe("loadTeamTagPickReasons", () => {
  it("returns no reasons until tags exist for the event", async () => {
    const reasons = await loadTeamTagPickReasons(
      clientWith(async () => ({ rows: [] })),
      { orgId, eventKey: "2026casj" },
    );
    expect(reasons).toEqual([]);
  });

  it("returns an empty list when the event key is blank", async () => {
    let queried = false;
    const reasons = await loadTeamTagPickReasons(
      clientWith(async () => {
        queried = true;
        return { rows: [] };
      }),
      { orgId, eventKey: "" },
    );
    expect(reasons).toEqual([]);
    expect(queried).toBe(false);
  });

  it("projects loaded event tags into pick-clock reasons", async () => {
    const reasons = await loadTeamTagPickReasons(
      clientWith(async () => ({
        rows: [
          {
            id: "1",
            tagId: "def",
            tagSlug: "defense",
            tagName: "Defense",
            teamNumber: 254,
            eventKey: "2026casj",
            matchKey: null,
            notes: null,
          },
        ],
      })),
      { orgId, eventKey: "2026casj", teamNumber: 254 },
    );
    expect(reasons).toEqual([
      {
        label: "Defense",
        tone: "strong",
        tagSlug: "defense",
        teamNumber: 254,
        source: "drive_team_tag",
      },
    ]);
  });

  it("degrades to an empty list when tag tables are not installed", async () => {
    const reasons = await loadTeamTagPickReasons(
      clientWith(async () => {
        const error = Object.assign(new Error("missing"), { code: "42P01" });
        throw error;
      }),
      { orgId, eventKey: "2026casj" },
    );
    expect(reasons).toEqual([]);
  });
});

describe("loadTeamTagAssignments", () => {
  it("passes org, season, event, and team as bound parameters", async () => {
    let seen: { sql: string; params: unknown[] } | null = null;
    await loadTeamTagAssignments(
      clientWith(async (sql, params) => {
        seen = { sql, params };
        return { rows: [] };
      }),
      { orgId, seasonYear: 2026, eventKey: "2026casj", teamNumber: 254 },
    );
    expect(seen?.params).toEqual([orgId, 2026, "2026casj", 254]);
    expect(seen?.sql).toMatch(/\$1::uuid/);
    expect(seen?.sql).toMatch(/qualitative_team_tags/);
  });
});
