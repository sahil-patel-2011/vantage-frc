import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map AI Chat empty primary student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Metered Ask AI Chat; empty/setup shells. Empty keeps one **New private chat** primary; related stays in the header (**Budgets · Memory · Strategy**); Next-actions stay off empty. Setup is **Needs setup** with one EmptyState primary (**Connect Claude Code** / **Choose your team**). Next-actions paint only on ready. UsageCutoffBanner via MeteredAiCutoffBanner. `chat-client.tsx` is skip-list / multi-fetch — no fake last-snapshot. Setup badge is **Needs setup**. Empty keeps one primary.");
  });
});
