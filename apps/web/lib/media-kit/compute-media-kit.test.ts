import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeMediaKitView, generateOnePager } from "./compute-media-kit";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeMediaKitView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeMediaKitView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view with profile, assets, documents, and readiness", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254, orgName: "The Cheesy Poofs" }] };
      }
      if (sql.includes("FROM media_kit_profiles") && sql.includes("WHERE org_id = $1 AND season_year = $2")) {
        return {
          rows: [
            {
              seasonYear: 2026,
              missionStatement: "Inspire the next generation of engineers.",
              teamBio: "A rookie-mentoring FRC team based in the Bay Area.",
              foundedYear: 1999,
              achievements: ["Chairman's Award 2020"],
              contactEmail: "team254@example.com",
              websiteUrl: "https://team254.com",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM media_kit_assets")) {
        return {
          rows: [
            {
              id: "asset-1",
              kind: "logo",
              title: "Primary logo",
              url: "https://example.com/logo.png",
              description: null,
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM media_kit_documents") && sql.includes("WHERE org_id = $1 AND season_year = $2")) {
        return { rows: [] };
      }
      if (sql.includes("UNION SELECT DISTINCT season_year FROM media_kit_documents")) {
        return { rows: [{ seasonYear: 2026 }] };
      }
      return { rows: [] };
    });

    const view = await computeMediaKitView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.teamNumber).toBe(254);
    expect(view.profile?.missionStatement).toContain("Inspire");
    expect(view.assets).toHaveLength(1);
    expect(view.documents).toHaveLength(0);
    expect(view.readiness.tier).toBe("ready");
    expect(view.readiness.missingFields).toHaveLength(0);
  });
});

describe("generateOnePager", () => {
  it("builds a deterministic one-pager from the recorded profile and asset counts, and persists it", async () => {
    const inserted: { sql: string; params: unknown[] }[] = [];
    const client = makeClient((sql, params) => {
      if (sql.includes("FROM organizations WHERE id")) {
        return { rows: [{ teamNumber: 254, orgName: "The Cheesy Poofs" }] };
      }
      if (sql.includes("FROM media_kit_profiles WHERE org_id")) {
        return {
          rows: [
            {
              seasonYear: 2026,
              missionStatement: "Inspire the next generation of engineers.",
              teamBio: "A rookie-mentoring FRC team.",
              foundedYear: 1999,
              achievements: ["Chairman's Award 2020"],
              contactEmail: "team254@example.com",
              websiteUrl: "https://team254.com",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM media_kit_assets WHERE org_id")) {
        return { rows: [{ total: "3", logos: "1" }] };
      }
      if ((sql.includes("INSERT INTO ai_usage_events") || sql.includes("INSERT INTO ai_render_attempts"))) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO media_kit_documents")) {
        inserted.push({ sql, params });
        return { rows: [{ id: "doc-1", createdAt: "2026-02-01T00:00:00.000Z" }] };
      }
      return { rows: [] };
    });

    const doc = await generateOnePager(client, { orgId: ORG, userId: USER, seasonYear: 2026 });

    expect(doc.title).toContain("Team 254");
    expect(doc.sections.length).toBeGreaterThan(1);
    expect(doc.sections.some((s) => s.heading === "Mission")).toBe(true);
    expect(doc.sections.some((s) => s.heading === "Achievements")).toBe(true);

    const docInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO media_kit_documents"));
    expect(docInsert).toBeDefined();

    const usageInsert = inserted.find((entry) => (entry.sql.includes("INSERT INTO ai_usage_events") || entry.sql.includes("INSERT INTO ai_render_attempts")));
    expect(usageInsert).toBeDefined();
  });
});
