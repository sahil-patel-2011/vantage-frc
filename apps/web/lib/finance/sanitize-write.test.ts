import { describe, expect, it } from "vitest";
import { sanitizeFinanceWriteBody, stripPaymentFields } from "./sanitize-write";

describe("sanitizeFinanceWriteBody", () => {
  it("strips card and bank credential keys", () => {
    const cleaned = stripPaymentFields({
      title: "Bearings",
      cardNumber: "4111111111111111",
      cvv: "123",
      bank_account: "987654321012",
      routingNumber: "021000021",
    });
    expect(cleaned).toEqual({ title: "Bearings" });
  });

  it("redacts PAN-like digits in justification free text", () => {
    const cleaned = sanitizeFinanceWriteBody({
      title: "Wire",
      justification: "Pay with card 4111-1111-1111-1111 at Amazon",
      estimateUsd: 12,
    });
    expect(String(cleaned.justification)).not.toMatch(/4111/);
    expect(String(cleaned.justification)).toContain("[REDACTED]");
    expect(cleaned.estimateUsd).toBe(12);
  });
});
