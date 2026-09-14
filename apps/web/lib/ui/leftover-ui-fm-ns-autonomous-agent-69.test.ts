import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Autonomous Agent needs setup student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Plan → tools → answer (`packages/agent`); `web.search` + `web.fetch` only on sites the team allows (SSRF-guarded); org session + tool-result injection; metered `feature=agent`. **Persists** `autonomous_agent_runs` / `_steps` (goal, status, provider/model, truncated summaries/excerpts ≤8k, final answer, error class, usage_event ids) — **not** raw HTML, prompt dumps, or secrets. Empty history if none Setup badge is **Needs setup**.");
  });
});
