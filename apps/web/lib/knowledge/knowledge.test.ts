import { describe, expect, it } from "vitest";
import {
  applyKnowledgeTemplate,
  knowledgeHitHref,
  parseKnowledgeWikiAction,
  slugifyTitle,
  snippetFrom,
  TEMPLATE_KIND_LABEL,
  KNOWLEDGE_TEMPLATES,
} from "./index";

const ORG = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";
const TARGET = "33333333-3333-4333-8333-333333333333";

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
  });

  it("builds snippets and hrefs", () => {
    expect(snippetFrom("We chose swerve over tank for coverage.", "swerve")).toContain("swerve");
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
});
