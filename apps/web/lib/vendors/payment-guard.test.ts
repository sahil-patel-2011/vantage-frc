import { describe, expect, it } from "vitest";
import {
  VendorPaymentDataError,
  containsPaymentCard,
  guardVendorAccountNumber,
  luhnValid,
  redactVendorNotes,
} from "./payment-guard";

// Public test numbers (Visa, Mastercard, Amex) — Luhn-valid, never real accounts.
const VISA = "4111 1111 1111 1111";
const MASTERCARD = "5555-5555-5555-4444";
const AMEX = "378282246310005";

describe("vendor payment guard", () => {
  it("recognises card numbers by checksum, with or without separators", () => {
    expect(luhnValid("4111111111111111")).toBe(true);
    expect(luhnValid("4111111111111112")).toBe(false);
    for (const card of [VISA, MASTERCARD, AMEX]) expect(containsPaymentCard(`pay with ${card} please`)).toBe(true);
  });

  it("leaves supplier references, phone numbers and part numbers alone", () => {
    for (const text of ["104233", "AM-004512", "Acct 7788-1203", "1-800-555-0199", "REV-21-1650", "1234567890123"]) {
      expect(containsPaymentCard(text), text).toBe(false);
      expect(guardVendorAccountNumber(text)).toBe(text);
      expect(redactVendorNotes(text)).toBe(text);
    }
  });

  it("refuses a card number or security code in the account-number field", () => {
    expect(() => guardVendorAccountNumber(VISA)).toThrow(VendorPaymentDataError);
    expect(() => guardVendorAccountNumber("cvv 123")).toThrow(VendorPaymentDataError);
    // The CVV pattern is global; a refusal must not leave it primed to miss the next call.
    expect(guardVendorAccountNumber("AM-1")).toBe("AM-1");
    expect(guardVendorAccountNumber(null)).toBeNull();
  });

  it("removes only the card number and security code from notes", () => {
    expect(redactVendorNotes(`Card on file ${MASTERCARD}, CVV: 123. Ask for Dana at 1-800-555-0199.`)).toBe(
      "Card on file [card number removed], [security code removed]. Ask for Dana at 1-800-555-0199.",
    );
  });
});
