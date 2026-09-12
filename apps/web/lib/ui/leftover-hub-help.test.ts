import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Help / public strategy titles after leftover-hub-strips.
 * Hub labels stay Alliance desk and Media kit. Connect TBA stays.
 * Do not invent a last-snapshot.
 */
const FILES = [
  "lib/help/articles.ts",
  "app/features/strategy/page.tsx",
  "app/workflow/page.tsx",
  "app/llms-full.txt/route.ts",
] as const;

describe("leftover student Help / public hub-title chrome", () => {
  it("does not print leftover Alliance Selection Desk or Media Kit", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Alliance Selection Desk/);
      expect(src, rel).not.toMatch(/Media Kit/);
    }
    const articles = readFileSync(join(WEB, "lib/help/articles.ts"), "utf8");
    expect(articles).toMatch(/Connect TBA/);
    expect(articles).toMatch(/Choose your team/);
    expect(articles).toMatch(/Alliance desk/);
    const strategy = readFileSync(join(WEB, "app/features/strategy/page.tsx"), "utf8");
    expect(strategy).toMatch(/Alliance desk/);
  });
});
