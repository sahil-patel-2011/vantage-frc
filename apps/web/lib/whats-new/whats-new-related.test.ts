import { describe, expect, it } from "vitest";
import {
  enabledReleaseFlags,
  formatReleaseAudience,
  formatReleasePublishedAt,
  whatsNewNextActions,
  whatsNewRelatedLinks,
} from "./whats-new-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("whatsNewRelatedLinks", () => {
  it("includes Support and Pricing by default focus strip", () => {
    const links = whatsNewRelatedLinks({ include: ["support", "pricing", "inbox"] });
    expect(links.map((l) => l.id)).toEqual(["support", "pricing", "inbox"]);
    expect(links.find((l) => l.id === "support")?.href).toBe("/support");
    expect(links.find((l) => l.id === "pricing")?.href).toBe("/pricing");
  });

  it("can omit the active surface", () => {
    const links = whatsNewRelatedLinks({ active: "inbox" });
    expect(links.some((l) => l.id === "inbox")).toBe(false);
    expect(links.some((l) => l.id === "support")).toBe(true);
  });
});

describe("whatsNewNextActions", () => {
  it("keeps empty feed empty — never DEMO release history", () => {
    const actions = whatsNewNextActions({ releaseCount: 0 });
    expect(actions[0]?.id).toBe("empty");
    expect(actions[0]?.primary).toBe(true);
    expectPlainCopy(actions[0]?.detail.toLowerCase());
    expect(actions.some((a) => a.id === "pricing")).toBe(true);
    expect(actions.some((a) => a.id === "support")).toBe(true);
    expect(actions.every((a) => !/demo/i.test(a.label))).toBe(true);
  });

  it("prioritizes unread releases when real rows exist", () => {
    const actions = whatsNewNextActions({ releaseCount: 3, unreadCount: 2 });
    expect(actions[0]?.id).toBe("unread");
    expect(actions[0]?.label).toContain("2");
    expect(actions.some((a) => a.id === "support")).toBe(true);
    expect(actions.some((a) => a.id === "pricing")).toBe(true);
  });
});

describe("release Soft-UI formatters", () => {
  it("formats audience and published dates without inventing placeholders", () => {
    expect(formatReleaseAudience("paid")).toBe("Paid plans");
    expect(formatReleasePublishedAt(null)).toBeNull();
    expect(formatReleasePublishedAt("not-a-date")).toBeNull();
    expect(formatReleasePublishedAt("2026-07-18T12:00:00.000Z")).toMatch(/2026/);
  });

  it("lists only true feature flags", () => {
    expect(enabledReleaseFlags({ advanced_strategy: true, strategy_engine_v2: false })).toEqual([
      "advanced_strategy",
    ]);
    expect(enabledReleaseFlags(null)).toEqual([]);
  });
});
