/**
 * /api/announcements (A5-10): a long message is refused rather than cut, a refusal names what
 * was refused, and the author is not listed as having to confirm their own post.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "11111111-1111-4111-8111-111111111111";
const POST_ID = "22222222-2222-4222-8222-222222222222";

const state = vi.hoisted(() => ({ role: "owner", queries: [] as Array<{ sql: string; params: unknown[] }> }));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@vantage/core", () => ({
  auth: { api: { getSession: async () => ({ user: { id: "33333333-3333-4333-8333-333333333333" } }) } },
  resolveAuthBaseURL: () => "http://localhost",
  sendAnnouncementEmails: async () => ({ sent: 0, failed: 0, skipped: 0 }),
}));
vi.mock("@vantage/db", () => {
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      state.queries.push({ sql, params });
      if (sql.includes("FROM memberships m") && sql.includes("JOIN organizations o")) {
        return { rowCount: 1, rows: [{ orgId: ORG, orgName: "Team 6925", role: state.role }] };
      }
      return { rowCount: 0, rows: [] };
    },
  };
  return { withRls: async (_context: unknown, work: (c: typeof client) => Promise<unknown>) => work(client) };
});

const { GET, POST } = await import("./route");

function post(body: Record<string, unknown>) {
  return POST(
    new Request(`http://localhost/api/announcements?orgId=${ORG}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  state.role = "owner";
  state.queries = [];
});

describe("announcements", () => {
  it("refuses a message over 4,000 characters instead of cutting it", async () => {
    const response = await post({ action: "post", title: "Trip forms", body: "x".repeat(4001) });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/4,000 characters/);
    expect(state.queries.some((q) => q.sql.includes("INSERT INTO team_announcements"))).toBe(false);
  });

  it("names the refused action: a student deleting reads 'delete', not 'post'", async () => {
    state.role = "scout";
    const response = await post({ action: "delete", announcementId: POST_ID });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: string }).error).toBe("Only owners and admins can delete announcements");
  });

  it("leaves the author out of who has not confirmed", async () => {
    await GET(new Request(`http://localhost/api/announcements?orgId=${ORG}&outstandingFor=${POST_ID}`));
    const outstanding = state.queries.find((q) => q.sql.includes("announcement_acks"));
    expect(outstanding?.sql).toContain("a.created_by = m.user_id");
  });
});
