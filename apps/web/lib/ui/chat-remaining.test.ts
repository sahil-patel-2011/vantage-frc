/**
 * Remaining Chat student chrome after empty already has one New private chat.
 * Skip-list / multi-fetch — do not gold a fake last-snapshot on chat-client.
 * Stayed off web-performance and video-remaining.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AI_CHAT_RELATED_INCLUDE,
  aiChatNextActions,
  aiChatRelatedLinks,
  aiChatShellCopy,
} from "../ai-chat/ai-chat-related";
import { expectPlainCopy } from "./copy-assertions";

const WEB = join(__dirname, "..", "..");

const FILES = [
  "app/chat/page.tsx",
  "app/chat/chat-client.tsx",
  "lib/ai-chat/ai-chat-related.ts",
] as const;

function emptyStates(src: string): { tag: string; inner: string }[] {
  const blocks: { tag: string; inner: string }[] = [];
  let from = 0;
  while (true) {
    const start = src.indexOf("<EmptyState", from);
    if (start < 0) break;
    const tagEnd = src.indexOf(">", start);
    if (tagEnd < 0) break;
    const close = src.indexOf("</EmptyState>", tagEnd);
    if (close < 0) break;
    blocks.push({ tag: src.slice(start, tagEnd + 1), inner: src.slice(tagEnd + 1, close) });
    from = close + 1;
  }
  return blocks;
}

describe("Chat remaining student chrome", () => {
  it("does not print leftover engineering copy on Chat", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/FRC Assistant/);
      expect(src, rel).not.toMatch(/AI provider not configured/);
      expect(src, rel).not.toMatch(/Configure an AI provider key/);
      expect(src, rel).not.toMatch(/UsageCutoffBanner/);
      expect(src, rel).not.toMatch(/primary-action/);
      expect(src, rel).not.toMatch(/getFeatureSnapshot/);
      expect(src, rel).not.toMatch(/putFeatureSnapshot/);
    }
  });

  it("setup is Needs setup with one EmptyState primary; empty keeps one New private chat", () => {
    expect(aiChatShellCopy("setup").badge).toBe("Needs setup");
    expect(aiChatShellCopy("ready").title).toBe("Chat");
    expectPlainCopy(aiChatShellCopy("setup").description);
    expectPlainCopy(aiChatShellCopy("empty").description);

    expect(aiChatNextActions({ orgId: "org-1", shell: "empty" })).toEqual([]);
    expect(aiChatNextActions({ orgId: "org-1", shell: "setup" })).toEqual([]);

    const page = readFileSync(join(WEB, "app/chat/page.tsx"), "utf8");
    const pageCards = emptyStates(page);
    expect(pageCards.length).toBeGreaterThan(0);
    for (const card of pageCards) {
      expect(`${card.tag}${card.inner}`).toMatch(/Needs setup/);
      expect(card.inner.match(/<Button\b/g) ?? []).toHaveLength(1);
      expect(card.inner).toMatch(/variant="primary"/);
      expect(card.inner).toMatch(/Choose your team/);
    }

    const chat = readFileSync(join(WEB, "app/chat/chat-client.tsx"), "utf8");
    expect(chat).toMatch(/<h1>Chat<\/h1>/);
    expect(chat).toMatch(/shell === "setup" \|\| shell === "loading" \|\| shell === "auth_required" \|\| shell === "error"/);
    expect(chat).not.toMatch(/shell === "empty".*NextActions/s);
    expect(chat).toMatch(/shell === "ready" \? <NextActions/);
    expect(chat).toMatch(/Open Team Admin/);
    expect(chat).toMatch(/shell === "ready"/);

    const setupCards = emptyStates(chat);
    expect(setupCards.length).toBeGreaterThan(0);
    for (const card of setupCards) {
      expect(card.inner).toMatch(/ChatStatusPrimary/);
      expect(card.inner.match(/<Button\b/g) ?? []).toHaveLength(0);
      expect(card.inner).not.toMatch(/NextActions/);
    }
    expect(chat).toMatch(/case "setup":/);
    expect(chat).toMatch(/variant="primary"/);

    const emptyActions = chat.slice(chat.indexOf("ch-empty-actions"));
    const emptyBlock = emptyActions.slice(0, emptyActions.indexOf("</div>") + 6);
    expect(emptyBlock.match(/<Button\b/g) ?? []).toHaveLength(1);
    expect(emptyBlock).toMatch(/variant="primary"/);
    expect(emptyBlock).toMatch(/New private chat/);
    expect(emptyBlock).not.toMatch(/Next actions/);
    expect(chat).toMatch(/shell !== "empty"/);
  });

  it("related stays Budgets · Memory · Strategy in the header", () => {
    expect([...AI_CHAT_RELATED_INCLUDE]).toEqual(["budgets", "memory", "strategy"]);
    const links = aiChatRelatedLinks("org-1", { include: [...AI_CHAT_RELATED_INCLUDE] });
    expect(links.map((link) => link.label)).toEqual(["Budgets", "Memory", "Strategy"]);
  });
});
