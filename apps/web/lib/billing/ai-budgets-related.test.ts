import { describe, expect, it } from "vitest";
import {
  AI_BUDGETS_RELATED_INCLUDE,
  AI_BUDGETS_SCOPE_CARDS,
  AI_USAGE_RELATED_INCLUDE,
  aiBudgetsNextActions,
  aiBudgetsRelatedLinks,
  aiBudgetsShellCopy,
  aiUsageNextActions,
  aiUsageShellCopy,
  classifyAiBudgetsShell,
  classifyAiUsageShell,
  formatAiBudgetsCount,
  formatAiBudgetsMoney,
  isAiBudgetsDefault,
  shouldShowAiBudgetsSummaryTiles,
  isAiBudgetsIncompleteSetup,
  policySnapshotFromBudgetForm,
  type AiBudgetsPolicySnapshot,
} from "./ai-budgets-related";
import { expectPlainCopy } from "../ui/copy-assertions";

const defaults: AiBudgetsPolicySnapshot = {
  hasDailySpendLimit: false,
  hasMonthlySpendLimit: false,
  hasDailyTokenLimit: false,
  hasMonthlyTokenLimit: false,
  modelAllowlistEnabled: false,
  providerAllowlistEnabled: false,
  killSwitch: false,
};

describe("aiBudgetsRelatedLinks", () => {
  it("surfaces Chat / Usage / Pricing / Account via hubHref / withOrgHref", () => {
    const links = aiBudgetsRelatedLinks("org-1", {
      include: [...AI_BUDGETS_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["chat", "usage", "pricing", "account"]);
    expect(links.find((l) => l.id === "chat")?.href).toContain("/ai?");
    expect(links.find((l) => l.id === "chat")?.href).toContain("tab=chat");
    expect(links.find((l) => l.id === "chat")?.href).toContain("orgId=org-1");
    expect(links.find((l) => l.id === "usage")?.href).toContain("tab=usage");
    expect(links.find((l) => l.id === "pricing")?.href).toContain("/pricing");
    expect(links.find((l) => l.id === "account")?.href).toBe("/account");
  });

  it("never uses DEMO labels or raw ?orgId= JSX templates in Budgets paths", () => {
    const blob = JSON.stringify(aiBudgetsRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/\/team\/budgets\?orgId=/);
  });

  it("usage strip keeps Chat / Pricing / Account", () => {
    const links = aiBudgetsRelatedLinks("org-9", {
      include: [...AI_USAGE_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["chat", "pricing", "account", "governance"]);
  });
});

describe("classifyAiBudgetsShell + copy", () => {
  it("classifies empty, setup, ready, and forbidden", () => {
    expect(
      classifyAiBudgetsShell({ loading: false, orgId: "org-1", policy: defaults }),
    ).toBe("empty");
    expect(
      classifyAiBudgetsShell({
        loading: false,
        orgId: "org-1",
        policy: { ...defaults, modelAllowlistEnabled: true },
      }),
    ).toBe("setup");
    expect(
      classifyAiBudgetsShell({
        loading: false,
        orgId: "org-1",
        policy: { ...defaults, hasMonthlySpendLimit: true },
      }),
    ).toBe("ready");
    expect(
      classifyAiBudgetsShell({
        loading: false,
        orgId: "org-1",
        status: 403,
        policy: defaults,
      }),
    ).toBe("forbidden");
    expect(classifyAiBudgetsShell({ loading: false, orgId: null })).toBe("setup");
  });

  it("maps form fields without inventing DEMO caps", () => {
    expect(isAiBudgetsDefault(defaults)).toBe(true);
    expect(
      isAiBudgetsIncompleteSetup({ ...defaults, modelAllowlistEnabled: true }),
    ).toBe(true);
    expect(
      policySnapshotFromBudgetForm({
        monthlySpendLimitUsd: "40",
        killSwitch: false,
      }).hasMonthlySpendLimit,
    ).toBe(true);
  });

  it("refuses invented DEMO spend in empty/setup copy", () => {
    for (const kind of ["empty", "setup", "forbidden", "ready"] as const) {
      const copy = aiBudgetsShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
      expect(copy.description).toMatch(/Chat|Pricing|Account|limit/i);
    }
    expectPlainCopy(aiBudgetsShellCopy("empty").description);
  });
});

describe("aiBudgetsNextActions", () => {
  it("asks for a team when org is missing", () => {
    const actions = aiBudgetsNextActions({ shell: "empty" });
    expect(actions).toHaveLength(1);
    expect(actions[0]?.id).toBe("workspace");
    expect(actions[0]?.label).toBe("Choose your team");
    expect(actions[0]?.detail).not.toMatch(/pick a team first/i);
    expectPlainCopy(actions[0]!.detail);
  });

  it("keeps one primary on empty Chat limits", () => {
    const actions = aiBudgetsNextActions({ orgId: "org-1", shell: "empty" });
    expect(actions).toHaveLength(1);
    expect(actions[0]?.id).toBe("configure");
    expect(actions[0]?.primary).toBe(true);
    expect(actions[0]?.href).toBe("#org-hard-limits");
  });
});

describe("classifyAiUsageShell + next actions", () => {
  it("classifies empty ledger vs missing plan setup", () => {
    expect(
      classifyAiUsageShell({
        loading: false,
        orgId: "org-1",
        hasPlan: true,
        meteredCalls: 0,
      }),
    ).toBe("empty");
    expect(
      classifyAiUsageShell({
        loading: false,
        orgId: "org-1",
        hasPlan: false,
        meteredCalls: 0,
      }),
    ).toBe("setup");
    expect(
      classifyAiUsageShell({
        loading: false,
        orgId: "org-1",
        hasPlan: true,
        meteredCalls: 3,
      }),
    ).toBe("ready");
  });

  it("keeps one primary on empty usage", () => {
    const actions = aiUsageNextActions({ orgId: "org-2", shell: "empty" });
    expect(actions).toHaveLength(1);
    expect(actions[0]?.id).toBe("chat");
    expect(actions[0]?.href).toContain("tab=chat");
    expectPlainCopy(aiUsageShellCopy("empty").description);
    const noOrg = aiUsageNextActions({ shell: "setup" });
    expect(noOrg).toHaveLength(1);
    expect(noOrg[0]?.label).toBe("Choose your team");
    expect(noOrg[0]?.detail).not.toMatch(/pick a team first/i);
  });
});

describe("formatAiBudgetsMoney + scope cards", () => {
  it("formats only real spend and stays blank when the ledger is missing", () => {
    expect(formatAiBudgetsMoney(null, false)).toBe("…");
    expect(formatAiBudgetsMoney(null, true)).toBe("—");
    expect(formatAiBudgetsMoney("", true)).toBe("—");
    expect(formatAiBudgetsMoney("12.5", true)).toBe("$12.50");
    expect(formatAiBudgetsMoney(0, true)).toBe("$0.00");
    expect(formatAiBudgetsCount("4", true)).toBe("4");
    expect(formatAiBudgetsCount(null, false)).toBe("…");
    expect(formatAiBudgetsCount(null, true)).toBe("—");
    expect(shouldShowAiBudgetsSummaryTiles("empty")).toBe(false);
    expect(shouldShowAiBudgetsSummaryTiles("setup")).toBe(false);
    expect(shouldShowAiBudgetsSummaryTiles("ready")).toBe(true);
    expect(aiBudgetsShellCopy("setup").badge).toBe("Needs setup");
    expect(aiUsageShellCopy("setup").badge).toBe("Needs setup");
  });

  it("clarifies ownership without DEMO", () => {
    expect(AI_BUDGETS_SCOPE_CARDS.map((c) => c.id)).toEqual([
      "limits",
      "usage",
      "chat",
      "pricing",
    ]);
    expect(JSON.stringify(AI_BUDGETS_SCOPE_CARDS)).not.toMatch(/DEMO/i);
  });
});
