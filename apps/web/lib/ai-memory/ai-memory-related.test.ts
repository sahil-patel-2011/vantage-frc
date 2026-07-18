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
      expect(copy.description).toMatch(/never|not|empty|admin/i);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
    }
    expect(aiMemoryShellCopy("empty").description).toMatch(/invented|empty Neon/i);
    expect(aiMemoryShellCopy("setup").description).toMatch(/never DEMO/i);
  });
});

describe("aiMemoryNextActions", () => {
  it("asks for workspace when org is missing", () => {
    const actions = aiMemoryNextActions({ shell: "empty" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions[0]?.primary).toBe(true);
  });

  it("points empty at enable + Chat/Budgets", () => {
    const actions = aiMemoryNextActions({
      orgId: "org-1",
      shell: "empty",
      enabled: false,
      activeCount: 0,
    });
    expect(actions[0]?.id).toBe("enable");
    expect(actions.some((a) => a.id === "chat")).toBe(true);
    expect(actions.some((a) => a.id === "budgets")).toBe(true);
    expect(actions.find((a) => a.id === "chat")?.href).toContain("tab=chat");
  });

  it("points setup at promote-from-Chat", () => {
    const actions = aiMemoryNextActions({
      orgId: "org-1",
      shell: "setup",
      enabled: true,
      activeCount: 0,
    });
    expect(actions[0]?.id).toBe("promote");
    expect(actions[0]?.href).toContain("/ai");
  });

  it("points forbidden members at private Chat memory", () => {
    const actions = aiMemoryNextActions({ orgId: "org-1", shell: "forbidden" });
    expect(actions[0]?.id).toBe("chat-private");
    expect(actions.some((a) => a.id === "budgets")).toBe(true);
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
