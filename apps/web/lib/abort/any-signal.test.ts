import { afterEach, describe, expect, it } from "vitest";
import { anySignal } from "./any-signal";

describe("anySignal", () => {
  const native = (AbortSignal as { any?: unknown }).any;
  afterEach(() => {
    (AbortSignal as { any?: unknown }).any = native;
  });

  for (const mode of ["native", "fallback"] as const) {
    describe(mode, () => {
      const prepare = () => {
        if (mode === "fallback") (AbortSignal as { any?: unknown }).any = undefined;
      };

      it("aborts when any input aborts, with that input's reason", () => {
        prepare();
        const a = new AbortController();
        const b = new AbortController();
        const signal = anySignal([a.signal, b.signal]);
        expect(signal.aborted).toBe(false);
        b.abort("org switched");
        expect(signal.aborted).toBe(true);
        expect(signal.reason).toBe("org switched");
      });

      it("starts aborted when an input already is", () => {
        prepare();
        const a = new AbortController();
        a.abort("gone");
        expect(anySignal([a.signal, new AbortController().signal]).aborted).toBe(true);
      });
    });
  }
});
