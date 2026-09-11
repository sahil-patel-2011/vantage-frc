import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("product hub student chrome", () => {
  it("asks students to choose a team with one EmptyState primary", () => {
    const src = read("components/product-hub.tsx");
    expect(src).toContain('title="Choose your team"');
    expect(src).toContain('badge="Needs setup"');
    expect(src).not.toMatch(/Setup required/);
    expect(src).toContain('href="/workspace"');
    expect(src).toMatch(/Choose your team to open/);
    expect(src).not.toMatch(/Team needed/);
    expect(src).not.toMatch(/needs a team selected/);
  });

  it("does not hide the Team hub title", () => {
    const css = read("app/product-hub.css");
    expect(css).not.toMatch(/product-hub--team\s*>\s*\.app-page-header\s*\{[^}]*display:\s*none/);
  });

  it("does not put a TabBar inside EmptyState on hub shells", () => {
    const files = [
      "components/product-hub.tsx",
      "app/team/team-hub.tsx",
      "app/build/build-hub.tsx",
      "app/competition/competition-hub.tsx",
      "app/business/business-client.tsx",
      "app/business/fundraising-glance.tsx",
      "app/business/sponsor-pipeline-panel.tsx",
      "app/business/partner-placements-panel.tsx",
      "app/business/business-panels.tsx",
    ];
    for (const rel of files) {
      const src = read(rel);
      let from = 0;
      while (true) {
        const start = src.indexOf("<EmptyState", from);
        if (start < 0) break;
        const tagEnd = src.indexOf(">", start);
        if (tagEnd < 0) break;
        const opening = src.slice(start, tagEnd + 1);
        if (opening.endsWith("/>")) {
          from = tagEnd + 1;
          continue;
        }
        const close = src.indexOf("</EmptyState>", tagEnd);
        if (close < 0) break;
        const inner = src.slice(tagEnd + 1, close);
        expect(inner, rel).not.toMatch(/<TabBar\b/);
        expect(inner, rel).not.toMatch(/<[A-Z][A-Za-z0-9]*Related\b/);
        from = close + 1;
      }
    }
  });

  it("keeps Business funding-model tab filtering in the hub shell", () => {
    const src = read("app/business/business-client.tsx");
    expect(src).toContain("filterSponsorTabs");
    expect(src).toContain("product-hub product-hub--business");
  });
});
