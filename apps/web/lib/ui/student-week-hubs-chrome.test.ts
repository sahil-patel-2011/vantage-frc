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
  "app/strategy/pick-desk-chrome.tsx",
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

  it("setup badges stay Needs setup and Ask AI empty has one primary (Send) without a Next-actions neighbor", () => {
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
    expect(chat).not.toMatch(/NextActions/);
    // Ask AI empty: a welcome with no buttons of its own; Send is the one primary.
    const emptyBlock = chat.slice(chat.indexOf('className="ch-empty ask-empty"'), chat.indexOf("{thread ? ("));
    expect(emptyBlock.match(/<Button\b/g) ?? []).toHaveLength(0);
    expect(emptyBlock).not.toMatch(/Budgets/);
    expect(emptyBlock).not.toMatch(/Next actions/);
    const formStart = chat.indexOf('<form className="ch-composer ask-composer"');
    const formEnd = chat.indexOf("</form>", formStart);
    const composer = chat.slice(formStart, formEnd);
    expect(composer.match(/variant="primary"/g) ?? []).toHaveLength(1);
    // The grouped starters sit under the composer (22ae8cce3) as plain suggestions, not buttons.
    const suggestions = chat.slice(formEnd, chat.indexOf("</section>", formEnd));
    expect(suggestions).toMatch(/className="ask-suggestions"[\s\S]*<StarterGroups\b/);
    expect(suggestions).not.toMatch(/variant="primary"/);
  });
});
