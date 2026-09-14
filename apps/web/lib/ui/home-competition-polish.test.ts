import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { studentWidgetDescription, emptyHintFor } from "../../app/dashboard/widgets/widget-empty-copy";
import { aiChatNextActions, aiChatShellCopy } from "../ai-chat/ai-chat-related";
import { chemistryShellCopy } from "../chemistry/chemistry-related";
import { draftShellCopy } from "../strategy/draft-related";
import { pickClockNextActions, pickClockShellCopy } from "../strategy/pick-clock-related";
import { strategyShellCopy } from "../strategy/strategy-related";
import {
  VIDEO_ANALYSIS_RELATED_INCLUDE,
  videoAnalysisRelatedLinks,
  videoAnalysisShellCopy,
} from "../video-analysis/video-analysis-related";
import { VIDEO_RESCOUT_RELATED_INCLUDE, videoRescoutShellCopy } from "../video-rescout-related";
import { matchStrategyCardsShellCopy } from "../match-strategy-cards/match-strategy-cards-related";
import { allianceSelectionDeskShellCopy } from "../alliance-selection-desk/alliance-selection-desk-related";
import { expectPlainCopy } from "./copy-assertions";

const WEB = join(__dirname, "..", "..");

/**
 * Remaining student-visible Home + Competition chrome a new student hits this
 * week — not packing / hours / pick-desk / team-admin / business / Onshape.
 */
const FILES = [
  "app/dashboard/widgets/widget-empty-copy.ts",
  "app/dashboard/widgets/widget-shell.tsx",
  "lib/dashboard/snapshot.ts",
  "lib/strategy/strategy-related.ts",
  "app/strategy/strategy-client.tsx",
  "app/strategy/strategy-chrome.tsx",
  "app/strategy/strategy-live-panel.tsx",
  "lib/strategy/draft-related.ts",
  "app/strategy/draft/draft-client.tsx",
  "lib/strategy/pick-clock-related.ts",
  "app/pick-clock/pick-clock-client.tsx",
  "lib/chemistry/chemistry-related.ts",
  "app/chemistry/chemistry-client.tsx",
  "lib/alliance-selection-desk/alliance-selection-desk-related.ts",
  "app/alliance-selection-desk/alliance-selection-desk-client.tsx",
  "lib/match-strategy-cards/match-strategy-cards-related.ts",
  "lib/match-strategy-cards/compute-match-strategy-cards.ts",
  "app/match-strategy-cards/match-strategy-cards-client.tsx",
  "lib/strategy/pick-clock.ts",
  "lib/strategy/pick-assist.ts",
  "lib/video-analysis/video-analysis-related.ts",
  "lib/video-rescout-related.ts",
  "app/video/video-rescout-client.tsx",
  "lib/ai-chat/ai-chat-related.ts",
  "app/chat/chat-client.tsx",
  "app/messages/page.tsx",
] as const;

describe("home + competition polish for students this week", () => {
  it("does not print Setup required / TBA dump / Sync event metrics on this slice", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/Sync event metrics/);
      expect(src, rel).not.toMatch(/TBA\/Statbotics/);
      if (
        rel !== "lib/dashboard/snapshot.ts" &&
        rel !== "app/dashboard/widgets/widget-empty-copy.ts"
      ) {
        expect(src, rel).not.toMatch(/team_event_metrics/);
      }
      if (
        rel !== "lib/video-analysis/video-analysis-related.ts" &&
        rel !== "app/dashboard/widgets/widget-empty-copy.ts"
      ) {
        expect(src, rel).not.toMatch(/The Blue Alliance/);
        expect(src, rel).not.toMatch(/Connect TBA/);
        expect(src, rel).not.toMatch(/\bTBA\b/);
        expect(src, rel).not.toMatch(/\bEPA\b/);
      }
    }
  });

  it("setup badges stay Needs setup and Home widgets hide TBA payload messages", () => {
    expect(strategyShellCopy("setup").badge).toBe("Needs setup");
    expect(draftShellCopy("setup").badge).toBe("Needs setup");
    expect(pickClockShellCopy("setup").badge).toBe("Needs setup");
    expect(chemistryShellCopy("setup").badge).toBe("Needs setup");
    expect(videoAnalysisShellCopy("setup").badge).toBe("Needs setup");
    expect(videoRescoutShellCopy("setup").badge).toBe("Needs setup");
    expect(aiChatShellCopy("setup").badge).toBe("Needs setup");
    expect(matchStrategyCardsShellCopy("setup").badge).toBe("Needs setup");
    expect(allianceSelectionDeskShellCopy("setup").badge).toBe("Needs setup");
    expectPlainCopy(strategyShellCopy("setup").description);
    expectPlainCopy(draftShellCopy("empty").description);
    expectPlainCopy(pickClockShellCopy("ready").description);

    const hint = emptyHintFor("sync_status");
    expect(
      studentWidgetDescription(
        "The Blue Alliance is not connected. Save a key under Team data before match and ranking cards can fill in.",
        hint,
      ),
    ).toBe(hint.body);
  });

  it("Match video related strip is Event day · Match notes · Match video", () => {
    expect([...VIDEO_ANALYSIS_RELATED_INCLUDE]).toEqual(["command", "match-notes", "match-video"]);
    const links = videoAnalysisRelatedLinks("org-1", {
      include: [...VIDEO_ANALYSIS_RELATED_INCLUDE],
    });
    expect(links.map((link) => link.label)).toEqual(["Event day", "Match notes", "Match video"]);
    expect([...VIDEO_RESCOUT_RELATED_INCLUDE]).toEqual(["scouting", "command"]);
  });

  it("Chat empty has no next-actions neighbor; Pick clock empty is one Sync Team data", () => {
    expect(aiChatNextActions({ orgId: "org-1", shell: "empty" })).toEqual([]);
    const emptyClock = pickClockNextActions({
      orgId: "org-1",
      shell: "empty",
      hasRecommendation: false,
      availableCount: 0,
    });
    expect(emptyClock).toHaveLength(1);
    expect(emptyClock[0]?.label).toBe("Sync Team data");

    const chat = readFileSync(join(WEB, "app/chat/chat-client.tsx"), "utf8");
    expect(chat).toMatch(/shell !== "empty"/);
    expect(chat).toMatch(/New private chat/);
    const emptyActions = chat.slice(chat.indexOf("ch-empty-actions"));
    const emptyBlock = emptyActions.slice(0, emptyActions.indexOf("</div>") + 6);
    expect(emptyBlock.match(/<Button\b/g) ?? []).toHaveLength(1);
  });
});
