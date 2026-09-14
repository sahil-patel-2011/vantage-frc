import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Code Coach chrome after leftover-copilot. The Build hub
 * tab is Code. Route /code and identifiers stay. Do not invent a
 * last-snapshot.
 */
const FILES = [
  "app/code/page.tsx",
  "app/code/code-ready-view.tsx",
  "lib/code/code-related.ts",
  "lib/readiness-score/readiness-score-related.ts",
  "lib/code-deploy-log/code-deploy-log-related.ts",
  "lib/github/github-related.ts",
  "lib/editor/pair-related.ts",
  "lib/ai-chat/ai-chat-related.ts",
  "app/code-perf/code-perf-client.tsx",
  "app/code-deploy-log/code-deploy-log-client.tsx",
  "app/editor/pair/pair-client.tsx",
  "app/features/code/page.tsx",
  "app/features/page.tsx",
  "app/features/cad/page.tsx",
  "app/features/strategy/page.tsx",
  "app/llms.txt/route.ts",
  "app/llms-full.txt/route.ts",
  "app/for-teams/page.tsx",
  "app/workflow/page.tsx",
  "lib/marketing/seo.ts",
] as const;

describe("leftover student Code Coach chrome", () => {
  it("does not print Code Coach on this family", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Code Coach/);
      expect(src, rel).not.toMatch(/FRC Code Coach/);
      expect(src, rel).not.toMatch(/coach code/);
    }
    const ready = readFileSync(join(WEB, "app/code/code-ready-view.tsx"), "utf8");
    expect(ready).toMatch(/<h1>Code<\/h1>/);
    const page = readFileSync(join(WEB, "app/code/page.tsx"), "utf8");
    expect(page).toMatch(/title: "Code"/);
  });
});
