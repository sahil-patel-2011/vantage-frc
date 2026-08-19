import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import {
  applyKnowledgeTemplate,
  applyKnowledgeWikiAction,
  knowledgeHitHref,
  parseKnowledgeWikiAction,
  slugifyTitle,
  snippetFrom,
  TEMPLATE_KIND_LABEL,
  KNOWLEDGE_TEMPLATES,
} from "./index";

const ORG = "11111111-1111-4111-8111-111111111111";
const FOREIGN_ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID = "22222222-2222-4222-8222-222222222222";
const TARGET = "33333333-3333-4333-8333-333333333333";
const USER = "44444444-4444-4444-8444-444444444444";

function mockClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount: number }): PoolClient {
  return {
    query: vi.fn((sql: string, params: unknown[] = []) => Promise.resolve(handler(sql, params))),
  } as unknown as PoolClient;
}

describe("knowledge wiki helpers", () => {
  it("slugifies titles", () => {
    expect(slugifyTitle("Why Swerve Over Tank?")).toBe("why-swerve-over-tank");
    expect(slugifyTitle("  ")).toBe("page");
  });

  it("ships structured handoff templates", () => {
    expect(KNOWLEDGE_TEMPLATES.length).toBeGreaterThanOrEqual(5);
    expect(TEMPLATE_KIND_LABEL.season_handoff).toMatch(/handoff/i);
    const applied = applyKnowledgeTemplate("season_handoff", 254);
    expect(applied.title).toMatch(/handoff/i);
    expect(applied.body).toContain("Team 254");
    expect(applied.tags.length).toBeGreaterThan(0);
    const inventory = applyKnowledgeTemplate("inventory_handoff",254);
    expect(inventory.body).toMatch(/bin naming|Critical spares/i);
    expect(inventory.tags).toContain("inventory");
  });

  it("builds snippets and hrefs", () => {
    expect(snippetFrom("We chose swerve over tank for coverage.", "swerve")).toContain("swerve");
    expect(knowledgeHitHref("wiki", ID, ORG, "swerve")).toContain("/team?tab=knowledge");
    expect(knowledgeHitHref("wiki", ID, ORG, "swerve")).toContain(`orgId=${ORG}`);
    expect(knowledgeHitHref("wiki", ID, ORG, "swerve")).toContain("page=swerve");
    expect(knowledgeHitHref("decision", ID, ORG)).toContain("/decisions");
    expect(knowledgeHitHref("design_review", ID, ORG)).toMatch(/review/);
  });

  it("parses upsert / link / unlink actions", () => {
    expect(
      parseKnowledgeWikiAction({
        action: "upsert_page",
        orgId: ORG,
        title: "Swerve choice",
        templateKind: "cad_conventions",
        body: "## Notes",
        tags: "drivetrain, cad",
        pinned: true,
        seasonYear: 2026,
      }),
    ).toMatchObject({
      action: "upsert_page",
      templateKind: "cad_conventions",
      tags: ["drivetrain", "cad"],
      pinned: true,
      seasonYear: 2026,
    });

    expect(
      parseKnowledgeWikiAction({
        action: "upsert_page",
        orgId: ORG,
        fromTemplate: "role_onboarding",
      }),
    ).toMatchObject({ fromTemplate: "role_onboarding" });

    expect(
      parseKnowledgeWikiAction({
        action: "link",
        orgId: ORG,
        pageId: ID,
        targetType: "decision",
        targetId: TARGET,
        note: "Chose swerve",
      }),
    ).toMatchObject({ action: "link", targetType: "decision" });

    expect(parseKnowledgeWikiAction({ action: "unlink", orgId: ORG, linkId: ID })).toMatchObject({
      action: "unlink",
    });

    expect(() => parseKnowledgeWikiAction({ action: "nope", orgId: ORG })).toThrow(/Unsupported/);
  });

  it("blocks cross-org page updates and deletes (IDOR ownership)", async () => {
    const client = mockClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return {
          rows: [{ role: "admin", orgName: "Team A", teamNumber: 100 }],
          rowCount: 1,
        };
      }
      // UPDATE/DELETE with org_id clause finds nothing for a foreign page id.
      if (sql.includes("UPDATE knowledge_pages") || sql.includes("DELETE FROM knowledge_pages")) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(
      applyKnowledgeWikiAction(client, USER, {
        action: "upsert_page",
        orgId: ORG,
        id: ID,
        title: "Stolen",
        slug: "stolen",
        body: "nope",
        templateKind: "blank",
        seasonYear: 2026,
        tags: [],
        pinned: false,
      }),
    ).rejects.toThrow(/Wiki page not found/);

    await expect(
      applyKnowledgeWikiAction(client, USER, {
        action: "delete_page",
        orgId: ORG,
        id: ID,
      }),
    ).rejects.toThrow(/Wiki page not found/);

    const updateCall = (client.query as ReturnType<typeof vi.fn>).mock.calls.find((call) =>
      String(call[0]).includes("UPDATE knowledge_pages"),
    );
    expect(updateCall?.[1]).toEqual(expect.arrayContaining([ID, ORG]));

    const deleteCall = (client.query as ReturnType<typeof vi.fn>).mock.calls.find((call) =>
      String(call[0]).includes("DELETE FROM knowledge_pages"),
    );
    expect(deleteCall?.[1]).toEqual([ID, ORG]);
    expect(FOREIGN_ORG).not.toBe(ORG);
  });

  it("blocks linking to pages outside the caller's org", async () => {
    const client = mockClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return {
          rows: [{ role: "member", orgName: "Team A", teamNumber: 100 }],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM knowledge_pages")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });

    await expect(
      applyKnowledgeWikiAction(client, USER, {
        action: "link",
        orgId: ORG,
        pageId: ID,
        targetType: "decision",
        targetId: TARGET,
        note: null,
      }),
    ).rejects.toThrow(/Wiki page not found/);
  });
});
