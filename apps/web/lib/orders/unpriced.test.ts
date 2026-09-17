import { describe, expect, it } from "vitest";
import { validateOrderSubmit } from "./evaluate";

/**
 * A student links the part and says how many. A mentor says what it cost.
 *
 * The price used to be required at submission, which meant the season budget
 * was built out of students' estimates of what things cost — shipping, tax and
 * the school's supplier are all invisible from a product page. These tests pin
 * the two halves of the fix: the estimate is optional, and a missing one is
 * distinguishable from a genuinely free part.
 */

const BASE = {
  title: "Falcon 500",
  justification: "Two drivetrain spares after the gearbox failure at week 1.",
  quantity: 2,
  itemUrl: "https://example.test/falcon",
};

describe("validateOrderSubmit without a price", () => {
  it("accepts a request that only says what and how many", () => {
    const result = validateOrderSubmit(BASE);
    expect(result.ok).toBe(true);
  });

  it("marks it unpriced rather than free", () => {
    // A zero that means "nobody has costed this" and a zero that means "this is
    // free" must not be the same value in a budget.
    const result = validateOrderSubmit(BASE);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.priced).toBe(false);
    expect(result.value.estimateUsd).toBe(0);
  });

  it("still accepts an estimate from someone who knows it", () => {
    const result = validateOrderSubmit({ ...BASE, estimateUsd: 219.99 });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.priced).toBe(true);
    expect(result.value.estimateUsd).toBeCloseTo(219.99, 2);
  });

  it("treats a genuine zero as a price somebody set", () => {
    // Donated parts are real. Someone typing 0 has costed it.
    const result = validateOrderSubmit({ ...BASE, estimateUsd: 0 });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.priced).toBe(true);
    expect(result.value.estimateUsd).toBe(0);
  });

  it("treats an empty box as not answered, not as zero", () => {
    // An empty form field arrives as "". Reading that as a free part would put
    // a silent zero in the budget.
    for (const estimateUsd of ["", null, undefined]) {
      const result = validateOrderSubmit({ ...BASE, estimateUsd });
      if (!result.ok) throw new Error(result.error);
      expect(result.value.priced, String(estimateUsd)).toBe(false);
    }
  });

  it("still refuses a price that is not a number", () => {
    const result = validateOrderSubmit({ ...BASE, estimateUsd: "about twenty quid" });
    expect(result.ok).toBe(false);
  });

  it("still refuses a negative price", () => {
    expect(validateOrderSubmit({ ...BASE, estimateUsd: -5 }).ok).toBe(false);
  });

  it("still refuses an absurd price", () => {
    expect(validateOrderSubmit({ ...BASE, estimateUsd: 5_000_000 }).ok).toBe(false);
  });

  it("still requires what it is and why", () => {
    expect(validateOrderSubmit({ ...BASE, title: "" }).ok).toBe(false);
    expect(validateOrderSubmit({ ...BASE, justification: "" }).ok).toBe(false);
  });

  it("still refuses a link that is not a web address", () => {
    expect(validateOrderSubmit({ ...BASE, itemUrl: "javascript:alert(1)" }).ok).toBe(false);
    expect(validateOrderSubmit({ ...BASE, itemUrl: "not a url" }).ok).toBe(false);
  });

  it("accepts a request with no link at all", () => {
    const { itemUrl, ...noLink } = BASE;
    void itemUrl;
    const result = validateOrderSubmit(noLink);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.itemUrl).toBeNull();
  });

  it("still holds the quantity rules", () => {
    expect(validateOrderSubmit({ ...BASE, quantity: 0 }).ok).toBe(false);
    expect(validateOrderSubmit({ ...BASE, quantity: 1.5 }).ok).toBe(false);
    expect(validateOrderSubmit({ ...BASE, quantity: 10_000 }).ok).toBe(false);
  });

  it("accepts the older field name a caller might still send", () => {
    const result = validateOrderSubmit({ ...BASE, unitCostUsd: 12.5 });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.priced).toBe(true);
  });
});
