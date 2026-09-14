import { describe, expect, it } from "vitest";
import {
  AGENT_PROMPT_TEMPLATES,
  SHOP_TUTORIALS,
  allShopTutorialLinks,
  cursorPackAskPrompt,
  shopTutorialById,
  totalShopTutorialMinutes,
} from "./shop-tutorials";

describe("Shop lab tutorials", () => {
  it("covers Limelight, GitHub, Cursor, prompts, and CAD without invented metrics", () => {
    expect(SHOP_TUTORIALS.map((tutorial) => tutorial.id)).toEqual([
      "limelight",
      "github",
      "cursor-pack",
      "agent-prompts",
      "cad-systems",
    ]);
    expect(totalShopTutorialMinutes()).toBeGreaterThan(200);
    const blob = JSON.stringify(SHOP_TUTORIALS);
    expect(blob).not.toMatch(/\bEPA\b/);
    expect(blob).not.toMatch(/two Limelights|second Limelight on the cart/i);
    expect(blob).toMatch(/one Limelight/);
  });

  it("gives every tutorial one primary official or in-app link", () => {
    for (const tutorial of SHOP_TUTORIALS) {
      expect(tutorial.links.filter((link) => link.primary), tutorial.id).toHaveLength(1);
      expect(tutorial.steps.length, tutorial.id).toBeGreaterThan(2);
      expect(tutorial.verify.length, tutorial.id).toBeGreaterThan(40);
    }
    for (const link of allShopTutorialLinks()) {
      expect(link.href.startsWith("https://") || link.href.startsWith("/"), link.href).toBe(true);
      expect(link.href.toLowerCase().includes("thecadvideotutor")).toBe(false);
    }
    const hrefs = allShopTutorialLinks().map((link) => link.href);
    expect(hrefs.some((href) => href.includes("docs.limelightvision.io"))).toBe(true);
    expect(hrefs.some((href) => href.includes("docs.github.com"))).toBe(true);
    expect(hrefs.some((href) => href.includes("cursor.com/docs"))).toBe(true);
  });

  it("resolves ids exhaustively and keeps the Cursor ask to one job", () => {
    expect(shopTutorialById("limelight").title).toMatch(/Limelight/);
    const ask = cursorPackAskPrompt();
    expect(ask).toMatch(/one Limelight/);
    expect(ask).toMatch(/Self-review/);
    expect(ask).not.toMatch(/deploy to Vercel/i);
    expect(AGENT_PROMPT_TEMPLATES).toHaveLength(3);
    for (const template of AGENT_PROMPT_TEMPLATES) {
      expect(template.body).toMatch(/Self-review/);
      expect(template.body).toMatch(/Do not/);
    }
  });
});
