import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scoutingShellCopy } from "../scouting/scouting-related";
import { strategyShellCopy } from "../strategy/strategy-related";
import { videoRescoutShellCopy } from "../video-rescout-related";
import { aiChatShellCopy } from "../ai-chat/ai-chat-related";
import { pickDeskShellCopy } from "../strategy/pick-desk-related";
import { expectPlainCopy } from "./copy-assertions";

const WEB = join(__dirname, "..", "..");

/**
 * Student-week hubs a new FRC student opens this week: Competition (Scouting /
 * Strategy / Pick clock / Match checklist), Match video, Business, CAD setup,
 * and Ask AI Chat. Leftover mill chrome is locked separately.
 */
const FILES = [
  "lib/scouting/scouting-related.ts",
  "app/scouting/scouting-chrome.tsx",
  "lib/scouting/lineup-related.ts",
  "app/scouting/lineup/page.tsx",
  "app/scouting/forms/page.tsx",
  "lib/strategy/strategy-related.ts",
  "app/strategy/strategy-chrome.tsx",
  "app/strategy/strategy-client.tsx",
  "lib/strategy/pick-desk-related.ts",
  "app/strategy/pick-list-workbench.tsx",
  "lib/strategy/pick-clock-related.ts",
  "app/pick-clock/pick-clock-client.tsx",
  "lib/video-rescout-related.ts",
  "app/video/video-rescout-client.tsx",
  "app/business/business-client.tsx",
  "app/orders/orders-client.tsx",
  "app/impact/impact-client.tsx",
  "app/cad/setup/page.tsx",
  "lib/ai-chat/ai-chat-related.ts",
  "app/chat/chat-client.tsx",
] as const;

describe("student-week hub chrome", () => {
  it("does not print Setup required / TBA/Statbotics / VANTAGE on this week's boards", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/VANTAGE \//);
      expect(src, rel).not.toMatch(/TBA\/Statbotics/);
      expect(src, rel).not.toMatch(/team_event_metrics/);
      expect(src, rel).not.toMatch(/primary-action/);
    }
  });

  it("setup badges stay Needs setup and Chat empty has one primary without a Next-actions neighbor", () => {
    expect(scoutingShellCopy("setup").badge).toBe("Needs setup");
    expect(strategyShellCopy("setup").badge).toBe("Needs setup");
    expect(videoRescoutShellCopy("setup").badge).toBe("Needs setup");
    expect(aiChatShellCopy("setup").badge).toBe("Needs setup");
    expect(pickDeskShellCopy("setup").badge).toBe("Needs setup");
    expectPlainCopy(scoutingShellCopy("setup").description);
    expectPlainCopy(strategyShellCopy("setup").description);
    expectPlainCopy(videoRescoutShellCopy("setup").description);

    const chat = readFileSync(join(WEB, "app/chat/chat-client.tsx"), "utf8");
    expect(chat).toMatch(/shell === "setup" \|\| shell === "loading" \|\| shell === "auth_required" \|\| shell === "error"/);
    expect(chat).not.toMatch(/shell === "empty".*NextActions/s);
    const emptyActions = chat.slice(chat.indexOf("ch-empty-actions"));
    const emptyBlock = emptyActions.slice(0, emptyActions.indexOf("</div>") + 6);
    expect(emptyBlock.match(/<Button\b/g) ?? []).toHaveLength(1);
    expect(emptyBlock).toMatch(/variant="primary"/);
    expect(emptyBlock).toMatch(/New private chat/);
    expect(emptyBlock).not.toMatch(/Budgets/);
    expect(emptyBlock).not.toMatch(/Next actions/);
  });
});
