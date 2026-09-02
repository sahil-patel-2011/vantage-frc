import { describe, expect, it, vi } from "vitest";
import { computeExitInterviewView, currentSeasonYear } from "./compute-exit-interview";
import type { ExitInterviewRole, ExitInterviewStatus } from "./types";

type Row = {
  id: string;
  memberName: string;
  memberUserId: string | null;
  role: ExitInterviewRole;
  yearsOnTeam: number;
  graduationYear: number;
  seasonYear: number;
  highlights: string | null;
  adviceForFuture: string | null;
  skillsToDocument: string | null;
  willingToMentor: boolean;
  contactEmail: string | null;
  status: ExitInterviewStatus;
  knowledgePageId: string | null;
};

function makeClient(opts: { membership: { orgId: string; teamNumber: number | null } | null; rows: Row[]; seasons: number[] }) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("FROM exit_interview_invites")) {
      return { rows: [] };
    }
    if (sql.includes("FROM memberships m JOIN users u")) {
      return { rows: [] };
    }
    if (sql.includes("FROM memberships")) {
      return { rows: opts.membership ? [opts.membership] : [] };
    }
    if (sql.includes("SELECT DISTINCT season_year")) {
      return { rows: opts.seasons.map((seasonYear) => ({ seasonYear })) };
    }
    if (sql.includes("FROM knowledge_pages")) {
      return { rows: [] };
    }
    if (sql.includes("FROM exit_interview_responses")) {
      return { rows: opts.rows };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
  return { query } as unknown as import("@neondatabase/serverless").PoolClient;
}

describe("computeExitInterviewView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient({ membership: null, rows: [], seasons: [] });
    const view = await computeExitInterviewView(client, { userId: "user-1", requestedOrg: null });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view with a summary computed from mock rows", async () => {
    const season = currentSeasonYear();
    const rows: Row[] = [
      {
        id: "rec-1",
        memberName: "Ada Lovelace",
        memberUserId: "user-2",
        role: "programming",
        yearsOnTeam: 3,
        graduationYear: 2026,
        seasonYear: season,
        highlights: "Led autonomous routines",
        adviceForFuture: "Start vision tuning earlier",
        skillsToDocument: "Path planning pipeline",
        willingToMentor: true,
        contactEmail: "ada@example.com",
        status: "submitted",
        knowledgePageId: "wiki-1",
      },
      {
        id: "rec-2",
        memberName: "Grace Hopper",
        memberUserId: null,
        role: "mechanical",
        yearsOnTeam: 2,
        graduationYear: 2026,
        seasonYear: season,
        highlights: null,
        adviceForFuture: null,
        skillsToDocument: null,
        willingToMentor: false,
        contactEmail: null,
        status: "draft",
        knowledgePageId: null,
      },
    ];
    const client = makeClient({
      membership: { orgId: "org-1", teamNumber: 1234 },
      rows,
      seasons: [season],
    });

    const view = await computeExitInterviewView(client, { userId: "user-1", requestedOrg: "org-1" });
    expect(view.status).toBe("live");
    if (view.status !== "live") return;
    expect(view.orgId).toBe("org-1");
    expect(view.teamNumber).toBe(1234);
    expect(view.records).toHaveLength(2);
    expect(view.summary.totalRecords).toBe(2);
    expect(view.summary.submittedCount).toBe(1);
    expect(view.summary.draftCount).toBe(1);
    expect(view.summary.mentorshipWillingCount).toBe(1);
    expect(view.summary.wikiPageCount).toBe(1);
    expect(view.summary.byRole.find((r) => r.role === "programming")?.count).toBe(1);
    expect(view.summary.byGradYear).toEqual([{ graduationYear: 2026, count: 2 }]);
  });
});
