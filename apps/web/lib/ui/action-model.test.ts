import { describe, expect, it } from "vitest";
import {
  buildActionModel,
  flattenActionModel,
  visibleActionCount,
  type ActionSpec,
} from "./action-model";

const a = (id: string, extra: Partial<ActionSpec> = {}): ActionSpec => ({ id, label: id, ...extra });

/** Every permutation-ish input the invariant tests sweep over. */
const CORPUS: ActionSpec[][] = [
  [],
  [a("one")],
  [a("save", { intent: "primary" })],
  [a("delete", { intent: "destructive" })],
  [a("delete", { intent: "destructive" }), a("nuke", { intent: "destructive" })],
  [a("a"), a("b"), a("c"), a("d"), a("e"), a("f")],
  [a("a"), a("save", { intent: "primary" }), a("b"), a("delete", { intent: "destructive" })],
  [a("p1", { intent: "primary" }), a("p2", { intent: "primary" }), a("p3", { intent: "primary" })],
  [a("d", { intent: "destructive" }), a("x"), a("y"), a("z"), a("w")],
  [a("x", { disabled: true }), a("y", { disabled: true })],
  [a("dup"), a("dup"), a("dup")],
];

describe("buildActionModel — one-primary invariant", () => {
  it("never yields more than one primary, for any input", () => {
    for (const input of CORPUS) {
      const model = buildActionModel(input);
      const primaries = flattenActionModel(model).filter((x) => x.placement === "primary");
      expect(primaries.length, JSON.stringify(input.map((i) => i.id))).toBeLessThanOrEqual(1);
    }
  });

  it("yields zero primaries only when there is nothing safe to promote", () => {
    expect(buildActionModel([]).primary).toBeNull();
    expect(buildActionModel([a("d", { intent: "destructive" })]).primary).toBeNull();
    expect(buildActionModel([a("x")]).primary?.id).toBe("x");
  });

  it("honours an explicit primary request over input order", () => {
    const model = buildActionModel([a("first"), a("second"), a("save", { intent: "primary" })]);
    expect(model.primary?.id).toBe("save");
    expect(model.secondary.map((s) => s.id)).toEqual(["first", "second"]);
  });

  it("picks only the first of several primary requests; the rest demote", () => {
    const model = buildActionModel([
      a("p1", { intent: "primary" }),
      a("p2", { intent: "primary" }),
      a("p3", { intent: "primary" }),
    ]);
    expect(model.primary?.id).toBe("p1");
    expect(model.secondary.map((s) => s.id)).toEqual(["p2", "p3"]);
    expect(model.overflow).toHaveLength(0);
  });

  it("can skip a disabled action when allowDisabledPrimary is false", () => {
    const input = [a("busy", { intent: "primary", disabled: true }), a("ready")];
    expect(buildActionModel(input).primary?.id).toBe("busy");
    expect(buildActionModel(input, { allowDisabledPrimary: false }).primary?.id).toBe("ready");
    expect(
      buildActionModel([a("busy", { disabled: true })], { allowDisabledPrimary: false }).primary,
    ).toBeNull();
  });
});

describe("buildActionModel — destructive actions", () => {
  it("never surfaces a destructive action as primary, even when it asks", () => {
    for (const input of CORPUS) {
      const model = buildActionModel(input);
      expect(model.primary?.intent).not.toBe("destructive");
    }
    const model = buildActionModel([a("delete", { intent: "destructive" })]);
    expect(model.primary).toBeNull();
    expect(model.overflow.map((o) => o.id)).toEqual(["delete"]);
  });

  it("never surfaces a destructive action as secondary either", () => {
    const model = buildActionModel([a("delete", { intent: "destructive" }), a("edit")]);
    expect(model.primary?.id).toBe("edit");
    expect(model.secondary).toHaveLength(0);
    expect(model.overflow.map((o) => o.id)).toEqual(["delete"]);
  });

  it("flags every destructive action for confirmation and nothing else", () => {
    const model = buildActionModel([
      a("edit"),
      a("archive"),
      a("delete", { intent: "destructive" }),
      a("wipe", { intent: "destructive" }),
    ]);
    const flat = flattenActionModel(model);
    expect(flat.filter((x) => x.needsConfirm).map((x) => x.id)).toEqual(["delete", "wipe"]);
  });

  it("puts destructive actions after demoted safe actions in overflow", () => {
    const model = buildActionModel([
      a("del", { intent: "destructive" }),
      a("one"),
      a("two"),
      a("three"),
      a("four"),
    ]);
    expect(model.overflow.map((o) => o.id)).toEqual(["four", "del"]);
  });
});

describe("buildActionModel — completeness and ordering", () => {
  it("loses no action: every input id appears exactly once in the output", () => {
    for (const input of CORPUS) {
      const expected = [...new Set(input.map((i) => i.id))].sort();
      const got = flattenActionModel(buildActionModel(input))
        .map((x) => x.id)
        .sort();
      expect(got).toEqual(expected);
    }
  });

  it("collapses duplicate ids to the first occurrence", () => {
    const model = buildActionModel([a("dup", { label: "first" }), a("dup", { label: "second" })]);
    expect(flattenActionModel(model)).toHaveLength(1);
    expect(model.primary?.label).toBe("first");
  });

  it("is stable: same input, same output ordering, every time", () => {
    const input = [a("a"), a("b"), a("c"), a("d"), a("e")];
    const first = flattenActionModel(buildActionModel(input)).map((x) => x.id);
    for (let i = 0; i < 5; i += 1) {
      expect(flattenActionModel(buildActionModel(input)).map((x) => x.id)).toEqual(first);
    }
    expect(first).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("sorts by weight ascending, tie-broken by input order", () => {
    const model = buildActionModel([
      a("late", { weight: 10 }),
      a("early", { weight: -5 }),
      a("mid-a"),
      a("mid-b"),
    ]);
    expect(flattenActionModel(model).map((x) => x.id)).toEqual(["early", "mid-a", "mid-b", "late"]);
  });

  it("caps secondary at two by default and honours maxSecondary", () => {
    const input = [a("a"), a("b"), a("c"), a("d"), a("e")];
    expect(buildActionModel(input).secondary).toHaveLength(2);
    expect(buildActionModel(input).overflow.map((o) => o.id)).toEqual(["d", "e"]);
    expect(buildActionModel(input, { maxSecondary: 0 }).secondary).toHaveLength(0);
    expect(buildActionModel(input, { maxSecondary: 0 }).overflow).toHaveLength(4);
    expect(buildActionModel(input, { maxSecondary: -3 }).secondary).toHaveLength(0);
    expect(buildActionModel(input, { maxSecondary: 99 }).overflow).toHaveLength(0);
  });

  it("keeps at most three controls one tap away", () => {
    for (const input of CORPUS) {
      expect(visibleActionCount(buildActionModel(input))).toBeLessThanOrEqual(3);
    }
  });

  it("preserves testId, href, hint, shortcut and handler identity", () => {
    const onClick = () => {};
    const model = buildActionModel([
      a("go", { testId: "go-btn", onClick, hint: "does the thing", shortcut: "G" }),
      a("docs", { href: "/docs" }),
    ]);
    expect(model.primary?.testId).toBe("go-btn");
    expect(model.primary?.onClick).toBe(onClick);
    expect(model.primary?.hint).toBe("does the thing");
    expect(model.primary?.shortcut).toBe("G");
    expect(model.secondary[0]?.href).toBe("/docs");
  });

  it("ignores malformed entries rather than rendering an unlabelled control", () => {
    const input = [a(""), a("real")] as ActionSpec[];
    expect(flattenActionModel(buildActionModel(input)).map((x) => x.id)).toEqual(["real"]);
  });

  it("does not mutate its input", () => {
    const input = [a("b", { weight: 2 }), a("a", { weight: 1 })];
    const snapshot = JSON.stringify(input);
    buildActionModel(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
