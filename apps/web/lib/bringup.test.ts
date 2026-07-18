import { describe, expect, it } from "vitest";
import { BRINGUP_TEMPLATE, computeProgress, parseBringupAction } from "./bringup";

describe("BRINGUP_TEMPLATE", () => {
  it("covers all four phases", () => {
    const phases = new Set(BRINGUP_TEMPLATE.map((i) => i.phase));
    expect([...phases].sort()).toEqual(["electrical", "mechanical", "software", "validation"]);
  });
});

describe("computeProgress", () => {
  it("counts pass/na as done and flags readiness only with zero failures", () => {
    const p = computeProgress([{ result: "pass" }, { result: "na" }, { result: "pending" }]);
    expect(p.done).toBe(2);
    expect(p.total).toBe(3);
    expect(p.percent).toBe(67);
    expect(p.ready).toBe(false);
  });
  it("is ready when every item passes/na and none failed", () => {
    expect(computeProgress([{ result: "pass" }, { result: "na" }]).ready).toBe(true);
  });
  it("is not ready if anything failed even when the rest are done", () => {
    const p = computeProgress([{ result: "pass" }, { result: "fail" }]);
    expect(p.failed).toBe(1);
    expect(p.ready).toBe(false);
  });
});

describe("parseBringupAction", () => {
  it("parses seed_template with a season year", () => {
    expect(parseBringupAction({ action: "seed_template", orgId: "o1", seasonYear: 2026 })).toMatchObject({ action: "seed_template" });
  });
  it("rejects add_item with an invalid phase", () => {
    expect(() => parseBringupAction({ action: "add_item", orgId: "o1", seasonYear: 2026, phase: "chemistry", label: "x" })).toThrow(/phase/);
  });
  it("rejects set_result with an invalid result", () => {
    expect(() => parseBringupAction({ action: "set_result", orgId: "o1", id: "i1", result: "maybe" })).toThrow(/result/);
  });
  it("rejects an unsupported action", () => {
    expect(() => parseBringupAction({ action: "yeet", orgId: "o1" })).toThrow(/Unsupported/);
  });
});
