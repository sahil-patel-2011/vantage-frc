import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map AI keys choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("**Mine** vs **Team**. Personal OpenAI/Anthropic override the team for that member. OpenAI base URL for Ollama / LM Studio. Google/OpenRouter and Automode under More. Setup badge is **Needs setup**; missing storage offers one **Connect Claude Code** primary. Related strip is **Chat · Claude Code**. Load/mutate/shell is `ai-keys-client.tsx`; chrome, provider cards, and the painted workbench live in sibling modules. Mine / Team stay sections, not a nested TabBar. No-team primary is **Choose your team**.");
  });
});
