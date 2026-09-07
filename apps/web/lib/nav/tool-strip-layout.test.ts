import { describe, expect, it } from "vitest";
import { groupToolStripEntries, layoutToolStrip, type ToolStripEntry } from "./tool-strip-layout";

const entry = (id: string, extra: Partial<ToolStripEntry> = {}): ToolStripEntry => ({
  id,
  label: id,
  ...extra,
});

const many = (count: number): ToolStripEntry[] =>
  Array.from({ length: count }, (_, index) => entry(`tool-${index}`));

describe("layoutToolStrip", () => {
  it("shows everything when the list fits", () => {
    const items = many(4);
    const layout = layoutToolStrip(items, "tool-0", 6);
    expect(layout.visible).toHaveLength(4);
    expect(layout.hiddenCount).toBe(0);
  });

  it("splits a long list at the visible count", () => {
    const layout = layoutToolStrip(many(22), "tool-0", 6);
    expect(layout.visible).toHaveLength(6);
    expect(layout.hiddenCount).toBe(16);
    expect(layout.visible.length + layout.hidden.length).toBe(22);
  });

  it("never hides the active tool, however deep it sits", () => {
    const layout = layoutToolStrip(many(22), "tool-19", 6);
    expect(layout.visible[0]?.id).toBe("tool-19");
    expect(layout.hidden.some((item) => item.id === "tool-19")).toBe(false);
  });

  it("leads with the active tool, then pinned ones, then source order", () => {
    const items = [
      entry("a"),
      entry("root", { featured: true }),
      entry("b"),
      entry("pinned", { featured: true }),
      entry("active"),
    ];
    const layout = layoutToolStrip(items, "active", 4);
    expect(layout.visible.map((item) => item.id)).toEqual(["active", "root", "pinned", "a"]);
  });

  it("keeps ordering stable for the same active tool", () => {
    const items = many(12);
    const first = layoutToolStrip(items, "tool-3", 5).visible.map((i) => i.id);
    const second = layoutToolStrip(items, "tool-3", 5).visible.map((i) => i.id);
    expect(first).toEqual(second);
  });

  it("expands into groups holding the whole list, not just the tail", () => {
    const items = many(22);
    const layout = layoutToolStrip(items, "tool-0", 6, true);
    // The row stands down so a family is never split between it and a heading.
    expect(layout.visible).toEqual([]);
    const grouped = layout.groups.flatMap((group) => group.items.map((item) => item.id));
    expect(grouped.sort()).toEqual(items.map((item) => item.id).sort());
  });

  it("keeps the count on the more chip stable when it opens", () => {
    const items = many(22);
    const closed = layoutToolStrip(items, "tool-9", 6, false);
    const open = layoutToolStrip(items, "tool-9", 6, true);
    expect(open.hiddenCount).toBe(closed.hiddenCount);
  });

  it("loses no item across visible and hidden", () => {
    const items = many(17);
    const layout = layoutToolStrip(items, "tool-9", 6);
    const seen = [...layout.visible, ...layout.hidden].map((item) => item.id).sort();
    expect(seen).toEqual(items.map((item) => item.id).sort());
  });

  it("always keeps at least one chip visible", () => {
    const layout = layoutToolStrip(many(8), "tool-2", 0);
    expect(layout.visible.length).toBeGreaterThanOrEqual(1);
    expect(layout.visible[0]?.id).toBe("tool-2");
  });

  it("handles an empty list", () => {
    const layout = layoutToolStrip([], "none", 6);
    expect(layout).toEqual({ visible: [], hidden: [], hiddenCount: 0, groups: [] });
  });

  it("handles an active id that is not in the list", () => {
    const layout = layoutToolStrip(many(3), "missing", 6);
    expect(layout.visible.map((item) => item.id)).toEqual(["tool-0", "tool-1", "tool-2"]);
  });

  it("carries href through so standalone tools can render as links", () => {
    const items = [entry("inline"), entry("standalone", { href: "/standalone" })];
    const layout = layoutToolStrip(items, "inline", 6);
    expect(layout.visible.find((item) => item.id === "standalone")?.href).toBe("/standalone");
  });
});

describe("groupToolStripEntries", () => {
  it("buckets by family and keeps catalog order inside each", () => {
    const groups = groupToolStripEntries([
      entry("a", { family: "Design" }),
      entry("b", { family: "Reliability" }),
      entry("c", { family: "Design" }),
    ]);
    expect(groups.map((group) => group.family)).toEqual(["Design", "Reliability"]);
    expect(groups[0]?.items.map((item) => item.id)).toEqual(["a", "c"]);
  });

  it("leads with the unnamed bucket however far down its first tool sat", () => {
    const groups = groupToolStripEntries([
      entry("a", { family: "Design" }),
      entry("loose"),
      entry("b", { family: "Design" }),
    ]);
    expect(groups[0]?.family).toBeNull();
    expect(groups[0]?.items.map((item) => item.id)).toEqual(["loose"]);
  });

  it("returns one untitled group when nothing sets a family", () => {
    // A workbench that never grouped its tools must render as it always did.
    const groups = groupToolStripEntries(many(5));
    expect(groups).toHaveLength(1);
    expect(groups[0]?.family).toBeNull();
    expect(groups[0]?.items).toHaveLength(5);
  });
});
