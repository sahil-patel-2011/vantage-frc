import { describe, expect, it, vi } from "vitest";
import { logExitInterview } from "./compute-exit-interview";
import {
  buildExitInterviewWikiBody,
  exitInterviewWikiHref,
  exitInterviewWikiSlug,
  exitInterviewWikiTitle,
} from "./wiki";

describe("exit interview wiki page", () => {
  it("fills a season-handoff page from real answers and leaves blanks as placeholders", () => {
    const body = buildExitInterviewWikiBody({
      memberName: "Ada Lovelace",
      role: "programming",
      yearsOnTeam: 3,
      graduationYear: 2026,
      seasonYear: 2026,
      highlights: "Led autonomous routines",
      adviceForFuture: "Start vision earlier",
      skillsToDocument: "Path planner",
      willingToMentor: true,
      contactEmail: "ada@example.com",
    });
    expect(body).toContain("Led autonomous routines");
    expect(body).toContain("Start vision earlier");
    expect(body).toContain("Path planner");
    expect(body).toContain("Willing to mentor: yes");
    expect(body).not.toMatch(/DEMO/i);
    expect(exitInterviewWikiTitle({ memberName: "Ada Lovelace", graduationYear: 2026 })).toMatch(/Ada Lovelace/);
    expect(exitInterviewWikiSlug({ memberName: "Ada Lovelace", seasonYear: 2026, suffix: "abc12345" })).toMatch(
      /^exit-2026-ada-lovelace-abc12345$/,
    );
    expect(exitInterviewWikiHref("org-1", "page-1")).toContain("/team?tab=knowledge");
    expect(exitInterviewWikiHref("org-1", "page-1")).toContain("orgId=org-1");
    expect(exitInterviewWikiHref("org-1", "page-1")).toContain("pageId=page-1");
  });

  it("does not invent highlights when the interview left them blank", () => {
    const body = buildExitInterviewWikiBody({
      memberName: "Grace",
      role: "mechanical",
      yearsOnTeam: 1,
      graduationYear: 2027,
      seasonYear: 2026,
      highlights: null,
      adviceForFuture: null,
      skillsToDocument: null,
      willingToMentor: false,
      contactEmail: null,
    });
    expect(body).toMatch(/## What we shipped\n-/);
    expect(body).toContain("Willing to mentor: no");
  });
});

describe("logExitInterview wiki write", () => {
  it("writes a knowledge page only when the interview is submitted", async () => {
    const query = vi.fn(async (sql: string) => {
      // The insert now resolves member_name against the roster first.
      if (sql.includes("FROM memberships")) return { rows: [], rowCount: 0 };
      if (sql.includes("INSERT INTO exit_interview_responses")) return { rows: [{ id: "rec-1" }] };
      if (sql.includes("SELECT 1 FROM knowledge_pages")) return { rows: [], rowCount: 0 };
      if (sql.includes("INSERT INTO knowledge_pages")) return { rows: [{ id: "page-1" }] };
      if (sql.includes("UPDATE exit_interview_responses")) return { rowCount: 1 };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const client = { query } as unknown as import("@neondatabase/serverless").PoolClient;
    const submitted = await logExitInterview(client, {
      orgId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      memberName: "Ada",
      role: "programming",
      yearsOnTeam: 3,
      graduationYear: 2026,
      seasonYear: 2026,
      highlights: "Autos",
      adviceForFuture: null,
      skillsToDocument: null,
      willingToMentor: false,
      contactEmail: null,
      status: "submitted",
    });
    expect(submitted.knowledgePageId).toBe("page-1");
    expect(query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO knowledge_pages"))).toBe(true);

    query.mockClear();
    query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM memberships")) return { rows: [], rowCount: 0 };
      if (sql.includes("INSERT INTO exit_interview_responses")) return { rows: [{ id: "rec-2" }] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const draft = await logExitInterview(client, {
      orgId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      memberName: "Grace",
      role: "mechanical",
      yearsOnTeam: 1,
      graduationYear: 2027,
      seasonYear: 2026,
      highlights: null,
      adviceForFuture: null,
      skillsToDocument: null,
      willingToMentor: false,
      contactEmail: null,
      status: "draft",
    });
    expect(draft.knowledgePageId).toBeNull();
    expect(query.mock.calls.some(([sql]) => String(sql).includes("knowledge_pages"))).toBe(false);
  });
});
