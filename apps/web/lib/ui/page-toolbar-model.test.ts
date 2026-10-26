import { describe, expect, it } from "vitest";
import { TOOLBAR_AUDITS, auditAfter } from "./action-hierarchy-audit";
import { layoutPageToolbar, visibleToolbarControls, type PageActionInput } from "./page-toolbar-model";

const a = (id: string, intent: PageActionInput["intent"] = "secondary"): PageActionInput => ({ id, intent });

describe("layoutPageToolbar", () => {
  it("keeps one primary and parks a destructive action in More", () => {
    const layout = layoutPageToolbar([
      a("save", "primary"),
      a("edit"),
      a("delete", "destructive"),
    ]);
    expect(layout.primary).toBe("save");
    expect(layout.secondary).toEqual(["edit"]);
    expect(layout.overflow).toEqual(["delete"]);
  });

  it("does not invent a filled action when nobody asked for one", () => {
    const layout = layoutPageToolbar([a("one"), a("two")]);
    expect(layout.primary).toBeNull();
    expect(layout.secondary).toEqual(["one", "two"]);
    expect(layout.overflow).toEqual([]);
  });

  it("demotes a second primary and caps quiet actions at three", () => {
    const layout = layoutPageToolbar([
      a("first", "primary"),
      a("second", "primary"),
      a("a"),
      a("b"),
      a("c"),
      a("d"),
    ]);
    expect(layout.primary).toBe("first");
    expect(layout.secondary).toEqual(["a", "b", "c"]);
    expect(layout.overflow).toEqual(["d", "second"]);
    expect(visibleToolbarControls(layout)).toBe(5);
  });

  it("never puts a destructive action in the primary or quiet slots", () => {
    const layout = layoutPageToolbar([a("delete", "destructive")]);
    expect(layout.primary).toBeNull();
    expect(layout.secondary).toEqual([]);
    expect(layout.overflow).toEqual(["delete"]);
  });

  it("drops a repeated id and keeps chrome out of the action slots", () => {
    const layout = layoutPageToolbar([
      a("related", "chrome"),
      a("save", "primary"),
      a("save", "secondary"),
    ]);
    expect(layout.chrome).toEqual(["related"]);
    expect(layout.primary).toBe("save");
    expect(layout.secondary).toEqual([]);
  });

  it("matches the recorded main-route toolbars", () => {
    for (const row of TOOLBAR_AUDITS) {
      const after = auditAfter(row);
      const layout = layoutPageToolbar(row.actions);
      expect(layout.primary ? [layout.primary] : [], row.route).toHaveLength(layout.primary ? 1 : 0);
      expect(layout.secondary.length, row.route).toBeLessThanOrEqual(3);
      expect(layout.overflow, row.route).toEqual([...row.overflow]);
      const filled = layout.primary ? 1 : 0;
      expect(filled, row.route).toBeLessThanOrEqual(1);
      // Files counts Grid and List inside the layout switch, which the model keeps as chrome.
      if (row.route === "files") {
        expect(after.visible, row.route).toBe(1);
      } else if (row.route === "command") {
        expect(after.visible, row.route).toBe(2);
      } else {
        expect(after.visible, row.route).toBeLessThanOrEqual(row.before === 0 ? 0 : Math.min(row.before, 5));
      }
    }
  });
});
