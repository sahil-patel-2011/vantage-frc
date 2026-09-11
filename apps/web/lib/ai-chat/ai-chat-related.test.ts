import { describe, expect, it } from "vitest";
import {
  AI_CHAT_RELATED_INCLUDE,
  AI_CHAT_SCOPE_CARDS,
  aiChatNextActions,
  aiChatRelatedLinks,
  aiChatShellCopy,
  classifyAiChatShell,
} from "./ai-chat-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("aiChatRelatedLinks", () => {
  it("returns empty without org", () => {
    expect(aiChatRelatedLinks()).toEqual([]);
  });

  it("surfaces Budgets, Memory, and Strategy with hub query params", () => {
    const links = aiChatRelatedLinks("org-1", { include: [...AI_CHAT_RELATED_INCLUDE] });
    expect(links.map((l) => l.id)).toEqual(["budgets", "memory", "strategy"]);
    expect(links.find((l) => l.id === "budgets")?.href).toContain("/ai?");
    expect(links.find((l) => l.id === "budgets")?.href).toContain("tab=budgets");
    expect(links.find((l) => l.id === "budgets")?.href).toContain("orgId=org-1");
    expect(links.find((l) => l.id === "memory")?.href).toContain("tab=memory");
    expect(links.find((l) => l.id === "strategy")?.href).toContain("/competition?");
    expect(links.find((l) => l.id === "strategy")?.href).toContain("tab=strategy");
  });

  it("never uses DEMO labels", () => {
    const blob = JSON.stringify(aiChatRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
  });
});

describe("classifyAiChatShell + copy", () => {
  it("classifies empty, setup, ready, and auth", () => {
    expect(
      classifyAiChatShell({
        loading: false,
        providerSetup: false,
        threadCount: 0,
        hasActiveThread: false,
      }),
    ).toBe("empty");
    expect(
      classifyAiChatShell({
        loading: false,
        providerSetup: true,
        threadCount: 0,
        hasActiveThread: false,
      }),
    ).toBe("setup");
    expect(
      classifyAiChatShell({
        loading: false,
        providerSetup: false,
        threadCount: 2,
        hasActiveThread: true,
      }),
    ).toBe("ready");
    expect(
      classifyAiChatShell({
        loading: false,
        status: 401,
        providerSetup: false,
        threadCount: 0,
        hasActiveThread: false,
      }),
    ).toBe("auth_required");
  });

  it("refuses invented DEMO replies in empty/setup copy", () => {
    for (const kind of ["empty", "setup", "ready", "error"] as const) {
      const copy = aiChatShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
    }
    expectPlainCopy(aiChatShellCopy("empty").description);
    expectPlainCopy(aiChatShellCopy("setup").description);
  });
});

describe("aiChatNextActions", () => {
  it("asks for workspace when org is missing", () => {
    const actions = aiChatNextActions({ shell: "empty" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions[0]?.primary).toBe(true);
    expectPlainCopy(actions[0]?.detail);
    expect(actions[0]?.detail).not.toMatch(/\borg\b/);
    expect(actions[0]?.detail).not.toMatch(/pick a team/i);
  });

  it("points empty at Budgets / Memory / Strategy", () => {
    const actions = aiChatNextActions({ orgId: "org-1", shell: "empty" });
    expect(actions[0]?.id).toBe("new-private");
    expect(actions.some((a) => a.id === "budgets")).toBe(true);
    expect(actions.some((a) => a.id === "memory")).toBe(true);
    expect(actions.some((a) => a.id === "strategy")).toBe(true);
    expect(actions.find((a) => a.id === "budgets")?.href).toContain("tab=budgets");
    expect(actions.find((a) => a.id === "strategy")?.href).toContain("tab=strategy");
  });

  it("points setup at Team Admin + Budgets/Memory", () => {
    const actions = aiChatNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions[0]?.id).toBe("admin");
    expect(actions.some((a) => a.id === "budgets")).toBe(true);
    expect(actions.some((a) => a.id === "memory")).toBe(true);
  });
});

describe("AI_CHAT_SCOPE_CARDS", () => {
  it("clarifies private vs team without DEMO", () => {
    expect(AI_CHAT_SCOPE_CARDS.map((c) => c.id)).toEqual(["private", "team"]);
    expect(JSON.stringify(AI_CHAT_SCOPE_CARDS)).not.toMatch(/DEMO/i);
  });
});
