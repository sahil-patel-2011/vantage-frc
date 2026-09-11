import { describe, expect, it } from "vitest";
import {
  AI_MEMORY_RELATED_INCLUDE,
  AI_MEMORY_SCOPE_CARDS,
  aiMemoryNextActions,
  aiMemoryRelatedLinks,
  aiMemoryShellCopy,
  classifyAiMemoryShell,
  formatAiMemoryMetric,
} from "./ai-memory-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("aiMemoryRelatedLinks", () => {
  it("returns empty without org", () => {
    expect(aiMemoryRelatedLinks()).toEqual([]);
  });

  it("surfaces Chat and Budgets with hub query params", () => {
    const links = aiMemoryRelatedLinks("org-1", { include: [...AI_MEMORY_RELATED_INCLUDE] });
    expect(links.map((l) => l.id)).toEqual(["chat", "budgets", "prompt-caching", "usage"]);
    expect(links.find((l) => l.id === "chat")?.href).toContain("/ai?");
    expect(links.find((l) => l.id === "chat")?.href).toContain("tab=chat");
    expect(links.find((l) => l.id === "chat")?.href).toContain("orgId=org-1");
    expect(links.find((l) => l.id === "budgets")?.href).toContain("tab=budgets");
    expect(links.find((l) => l.id === "prompt-caching")?.href).toContain("#prompt-caching");
  });

  it("never uses DEMO labels", () => {
    const blob = JSON.stringify(aiMemoryRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
  });
});

describe("classifyAiMemoryShell + copy", () => {
  it("classifies empty, setup, ready, and forbidden", () => {
    expect(
      classifyAiMemoryShell({ loading: false, enabled: false, activeCount: 0 }),
    ).toBe("empty");
    expect(
      classifyAiMemoryShell({ loading: false, enabled: true, activeCount: 0 }),
    ).toBe("setup");
    expect(
      classifyAiMemoryShell({ loading: false, enabled: true, activeCount: 3 }),
    ).toBe("ready");
    expect(
      classifyAiMemoryShell({
        loading: false,
        status: 403,
        enabled: false,
        activeCount: 0,
      }),
    ).toBe("forbidden");
    expect(
      classifyAiMemoryShell({
        loading: false,
        error: "Organization administrator access required",
        enabled: false,
        activeCount: 0,
      }),
    ).toBe("forbidden");
  });

  it("refuses invented DEMO memories in empty/setup copy", () => {
    for (const kind of ["empty", "setup", "forbidden", "ready"] as const) {
      const copy = aiMemoryShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
      expectPlainCopy(copy.description);
    }
  });
});

describe("aiMemoryNextActions", () => {
  it("asks for a team when org is missing", () => {
    const actions = aiMemoryNextActions({ shell: "empty" });
    expect(actions).toHaveLength(1);
    expect(actions[0]?.id).toBe("workspace");
    expect(actions[0]?.label).toBe("Choose your team");
    expect(actions[0]?.primary).toBe(true);
    expect(actions[0]?.detail).not.toMatch(/pick a team first/i);
    expect(actions[0]?.detail).not.toMatch(/per org/);
    expectPlainCopy(actions[0]!.detail);
  });

  it("keeps one primary on empty Memory", () => {
    const actions = aiMemoryNextActions({
      orgId: "org-1",
      shell: "empty",
      enabled: false,
      activeCount: 0,
    });
    expect(actions).toHaveLength(1);
    expect(actions[0]?.id).toBe("enable");
    expect(actions[0]?.primary).toBe(true);
    expect(actions[0]?.href).toBe("#team-memory-policy");
  });

  it("points setup at promote-from-Chat", () => {
    const actions = aiMemoryNextActions({
      orgId: "org-1",
      shell: "setup",
      enabled: true,
      activeCount: 0,
    });
    expect(actions).toHaveLength(1);
    expect(actions[0]?.id).toBe("promote");
    expect(actions[0]?.href).toContain("/ai");
  });

  it("points forbidden members at private Chat memory", () => {
    const actions = aiMemoryNextActions({ orgId: "org-1", shell: "forbidden" });
    expect(actions).toHaveLength(1);
    expect(actions[0]?.id).toBe("chat-private");
  });
});

describe("formatAiMemoryMetric + scope cards", () => {
  it("formats only real counts", () => {
    expect(formatAiMemoryMetric(null, false)).toBe("…");
    expect(formatAiMemoryMetric("12", true)).toBe("12");
    expect(formatAiMemoryMetric(-3, true)).toBe("0");
  });

  it("clarifies private vs team without DEMO", () => {
    expect(AI_MEMORY_SCOPE_CARDS.map((c) => c.id)).toEqual(["private", "team"]);
    expect(JSON.stringify(AI_MEMORY_SCOPE_CARDS)).not.toMatch(/DEMO/i);
  });
});
