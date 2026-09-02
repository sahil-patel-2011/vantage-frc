import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeMatchingGiftFinderView, generateDraftLetter } from "./compute-matching-gift-finder";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeMatchingGiftFinderView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeMatchingGiftFinderView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns setup_required when no contact has an employer set", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      if (sql.includes("SELECT COUNT(*)::text AS count FROM matching_gift_finder_programs")) {
        return { rows: [{ count: "8" }] };
      }
      if (sql.includes("FROM matching_gift_finder_contacts")) {
        return { rows: [{ id: "c1", fullName: "Jane Doe", relationship: "parent", employerName: null, email: null, notes: null, createdAt: "2026-01-01T00:00:00.000Z" }] };
      }
      if (sql.includes("FROM matching_gift_finder_programs")) return { rows: [] };
      if (sql.includes("FROM matching_gift_finder_pledges")) return { rows: [] };
      if (sql.includes("FROM matching_gift_finder_drafts")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeMatchingGiftFinderView(client, { userId: USER, requestedOrg: ORG });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBe(ORG);
    }
  });

  it("returns a live view with matched contacts joined against employer programs", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      if (sql.includes("SELECT COUNT(*)::text AS count FROM matching_gift_finder_programs")) {
        return { rows: [{ count: "1" }] };
      }
      if (sql.includes("FROM matching_gift_finder_contacts")) {
        return {
          rows: [
            {
              id: "c1",
              fullName: "Jane Doe",
              relationship: "parent",
              employerName: "Microsoft",
              email: "jane@example.com",
              notes: null,
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM matching_gift_finder_programs")) {
        return {
          rows: [
            {
              id: "p1",
              employerName: "Microsoft",
              matchRatio: "1:1",
              minGiftUsd: "25",
              maxGiftUsd: "15000",
              annualDeadline: "Within 12 months",
              submissionUrl: null,
              notes: null,
              source: "seed",
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM matching_gift_finder_pledges")) return { rows: [] };
      if (sql.includes("FROM matching_gift_finder_drafts")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeMatchingGiftFinderView(client, { userId: USER, requestedOrg: ORG });
    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.contacts).toHaveLength(1);
    expect(view.programs).toHaveLength(1);
    expect(view.matches).toHaveLength(1);
    expect(view.matches[0]?.program.employerName).toBe("Microsoft");
    expect(view.matches[0]?.hasPledge).toBe(false);
    expect(view.summary.contactsWithEmployer).toBe(1);
    expect(view.summary.unmatchedMatchCount).toBe(1);
  });
});

describe("generateDraftLetter", () => {
  it("drafts a deterministic HR request letter grounded in the contact and program record", async () => {
    const inserted: { sql: string; params: unknown[] }[] = [];
    const client = makeClient((sql, params) => {
      if (sql.includes("FROM matching_gift_finder_contacts WHERE id")) {
        return { rows: [{ fullName: "Jane Doe" }] };
      }
      if (sql.includes("FROM matching_gift_finder_programs WHERE id")) {
        return {
          rows: [
            {
              id: "p1",
              employerName: "Microsoft",
              matchRatio: "1:1",
              minGiftUsd: "25",
              maxGiftUsd: "15000",
              annualDeadline: "Within 12 months",
              submissionUrl: "https://example.com/match",
              notes: null,
              source: "seed",
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM organizations WHERE id")) {
        return { rows: [{ teamNumber: 254 }] };
      }
      if ((sql.includes("INSERT INTO ai_usage_events") || sql.includes("INSERT INTO ai_render_attempts"))) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO matching_gift_finder_drafts")) {
        inserted.push({ sql, params });
        return { rows: [{ id: "draft-1", createdAt: "2026-02-01T00:00:00.000Z" }] };
      }
      return { rows: [] };
    });

    const draft = await generateDraftLetter(client, {
      orgId: ORG,
      userId: USER,
      contactId: "c1",
      programId: "p1",
      seasonYear: 2026,
    });

    expect(draft.subject).toContain("Microsoft");
    expect(draft.body).toContain("Jane Doe");
    expect(draft.body).toContain("Team 254");
    expect(draft.body).toContain("https://example.com/match");

    const usageInsert = inserted.find((entry) => (entry.sql.includes("INSERT INTO ai_usage_events") || entry.sql.includes("INSERT INTO ai_render_attempts")));
    expect(usageInsert).toBeDefined();
    const draftInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO matching_gift_finder_drafts"));
    expect(draftInsert).toBeDefined();
  });
});
