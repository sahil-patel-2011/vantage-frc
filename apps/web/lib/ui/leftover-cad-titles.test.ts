import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student CAD vault / Learn CAD / Design reviews /
 * Prototypes / Sketch to brief titles after leftover-build-titles.
 * Hub labels stay CAD vault, Learn CAD, Design reviews,
 * Prototypes, and Sketch to brief. Routes stay. Drive folder
 * names stay. Do not invent a last-snapshot.
 */
const FILES = [
  "app/cad-vault/cad-vault-client.tsx",
  "app/cad-vault/cad-vault-chrome.tsx",
  "app/cad-vault/page.tsx",
  "lib/cad-vault/cad-vault-related.ts",
  "lib/manifests/cad-vault.manifest.ts",
  "app/cad-learn/cad-learn-client.tsx",
  "app/cad-learn/cad-learn-chrome.tsx",
  "app/cad-learn/page.tsx",
  "lib/cad-learn/cad-learn-related.ts",
  "app/reviews/reviews-client.tsx",
  "app/reviews/page.tsx",
  "app/prototype-tracker/prototype-tracker-client.tsx",
  "app/prototype-tracker/page.tsx",
  "lib/manifests/prototype-tracker.manifest.ts",
  "app/sketch-to-brief/sketch-to-brief-client.tsx",
  "app/sketch-to-brief/page.tsx",
  "lib/sketch-to-brief/sketch-to-brief-related.ts",
  "lib/sketch-to-brief/compute-sketch-to-brief.ts",
  "app/api/sketch-to-brief/route.ts",
  "lib/manifests/sketch-to-brief.manifest.ts",
  "lib/rule-impact/rule-impact-related.ts",
  "app/cad/setup/setup-client.tsx",
  "app/cad/connections/connections-client.tsx",
  "lib/offline/shell-routes.ts",
] as const;

describe("leftover student cad-title chrome", () => {
  it("does not print leftover Vault / Learn / Reviews / Tracker titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/CAD Vault/);
      expect(src, rel).not.toMatch(/CAD Learn/);
      expect(src, rel).not.toMatch(/Design Reviews/);
      expect(src, rel).not.toMatch(/Prototype-to-Decision Tracker/);
      expect(src, rel).not.toMatch(/Sketch-to-Brief/);
    }
    const vault = readFileSync(join(WEB, "app/cad-vault/cad-vault-chrome.tsx"), "utf8");
    expect(vault).toMatch(/title="CAD vault"/);
    const learn = readFileSync(join(WEB, "app/cad-learn/cad-learn-chrome.tsx"), "utf8");
    expect(learn).toMatch(/title="Learn CAD"/);
    const reviews = readFileSync(join(WEB, "app/reviews/reviews-client.tsx"), "utf8");
    expect(reviews).toMatch(/title="Design reviews"/);
    expect(reviews).toMatch(/feature="Design reviews"/);
    const proto = readFileSync(
      join(WEB, "app/prototype-tracker/prototype-tracker-client.tsx"),
      "utf8",
    );
    expect(proto).toMatch(/title="Prototypes"/);
    expect(proto).toMatch(/feature="Prototypes"/);
    const sketch = readFileSync(
      join(WEB, "app/sketch-to-brief/sketch-to-brief-client.tsx"),
      "utf8",
    );
    expect(sketch).toMatch(/title="Sketch to brief"/);
    expect(sketch).toMatch(/feature="Sketch to brief"/);
    const related = readFileSync(join(WEB, "lib/cad-vault/cad-vault-related.ts"), "utf8");
    expect(related).toMatch(/Opening CAD vault/);
    expect(related).not.toMatch(/title="Loading/);
    expect(related).toMatch(/Choose your team/);
    const sketchRelated = readFileSync(
      join(WEB, "lib/sketch-to-brief/sketch-to-brief-related.ts"),
      "utf8",
    );
    expect(sketchRelated).toMatch(/Opening Sketch to brief/);
    expect(sketchRelated).not.toMatch(/title="Loading/);
    expect(sketchRelated).toMatch(/Choose your team/);
  });
});
