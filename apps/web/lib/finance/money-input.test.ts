import { describe, expect, it } from "vitest";
import { parseMoneyInput } from "./money-input";

describe("parseMoneyInput (A5-08)", () => {
  it("reads numbers and the way people write money", () => {
    expect(parseMoneyInput(1234.5)).toEqual({ ok: true, value: 1234.5 });
    expect(parseMoneyInput("1200.50")).toEqual({ ok: true, value: 1200.5 });
    expect(parseMoneyInput("$1,200.50")).toEqual({ ok: true, value: 1200.5 });
    expect(parseMoneyInput("0")).toEqual({ ok: true, value: 0 });
  });

  it("refuses negatives, words and a third decimal instead of storing $0", () => {
    expect(parseMoneyInput(-50)).toEqual({ ok: false, reason: "The amount can't be negative." });
    expect(parseMoneyInput("-5", { label: "The budget" })).toEqual({ ok: false, reason: "The budget can't be negative." });
    expect(parseMoneyInput("abc").ok).toBe(false);
    expect(parseMoneyInput("12.345").ok).toBe(false);
    expect(parseMoneyInput({}).ok).toBe(false);
  });

  it("refuses an implausible amount", () => {
    expect(parseMoneyInput(99_999_999.99)).toEqual({ ok: false, reason: "The amount is more than $10,000,000. Check the number." });
  });

  it("treats empty as missing, or as 'none' where clearing is allowed", () => {
    expect(parseMoneyInput("").ok).toBe(false);
    expect(parseMoneyInput(null, { allowEmpty: true })).toEqual({ ok: true, value: null });
    expect(parseMoneyInput(undefined, { allowEmpty: true })).toEqual({ ok: true, value: null });
  });
});
