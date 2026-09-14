import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AI_BRIDGE_SETUP_STEPS,
  AI_BRIDGE_TITLE,
  aiBridgeShellCopy,
} from "../ai-bridge/ai-bridge-related";
import { offlineCapableLabel } from "../offline/shell-routes";
import { expectPlainCopy } from "./copy-assertions";

const WEB = join(__dirname, "..", "..");

const FILES = [
  "app/team/ai-bridge/ai-bridge-client.tsx",
  "app/team/ai-bridge/page.tsx",
  "lib/ai-bridge/ai-bridge-related.ts",
] as const;

describe("Claude Code student chrome", () => {
  it("uses Claude Code, Needs setup, and one approve primary", () => {
    expect(offlineCapableLabel("/team/ai-bridge")).toBe("Claude Code");
    expect(AI_BRIDGE_TITLE).toBe("Claude Code");
    expect(AI_BRIDGE_SETUP_STEPS).toHaveLength(3);
    expect(aiBridgeShellCopy("no-team").badge).toBe("Needs setup");
    expect(aiBridgeShellCopy("setup").title).toBe("Pair Claude Code");
    expectPlainCopy(aiBridgeShellCopy("setup").description);

    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/AI subscription bridge/);
      expect(src, rel).not.toMatch(/node bridge\.mjs/);
      expect(src, rel).not.toMatch(/docs\/AI_BRIDGE\.md/);
    }

    const client = readFileSync(join(WEB, "app/team/ai-bridge/ai-bridge-client.tsx"), "utf8");
    expect(client).toMatch(/Approve this computer/);
    expect(client).toMatch(/Pair this computer/);
    expect(client).toMatch(/aiBridgeShellCopy\("no-team"\)/);
    const related = readFileSync(join(WEB, "lib/ai-bridge/ai-bridge-related.ts"), "utf8");
    expect(related).toMatch(/Needs setup/);
  });
});
