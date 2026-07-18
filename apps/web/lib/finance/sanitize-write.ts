/**
 * Strip payment credential fields and redact PAN/routing-like patterns from
 * free-text before writing finance records. Vantage never stores card/bank data.
 */

import { redactFinanceTextForAi } from "@vantage/agent";

const PAYMENT_FIELD_KEYS = [
  "cardNumber",
  "card_number",
  "cvv",
  "cvc",
  "cardExpiry",
  "card_expiry",
  "expiry",
  "bankAccount",
  "bank_account",
  "routingNumber",
  "routing_number",
  "accountNumber",
  "account_number",
  "iban",
  "swift",
  "pan",
  "ssn",
] as const;

const TEXT_FIELDS = [
  "title",
  "itemName",
  "justification",
  "purpose",
  "reviewNotes",
  "reviewNote",
  "notes",
  "vendor",
  "label",
  "name",
  "description",
] as const;

export function stripPaymentFields(body: Record<string, unknown>): Record<string, unknown> {
  const cleaned = { ...body };
  for (const key of PAYMENT_FIELD_KEYS) {
    delete cleaned[key];
  }
  for (const key of Object.keys(cleaned)) {
    const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (
      normalized.includes("cardnumber") ||
      normalized.includes("routingnumber") ||
      normalized.includes("bankaccount") ||
      normalized === "cvv" ||
      normalized === "cvc" ||
      normalized === "iban" ||
      normalized === "pan"
    ) {
      delete cleaned[key];
    }
  }
  return cleaned;
}

/** Redact sensitive digit patterns from known free-text finance fields. */
export function redactFinanceWriteFields(body: Record<string, unknown>): Record<string, unknown> {
  const out = { ...body };
  for (const key of TEXT_FIELDS) {
    if (typeof out[key] === "string") {
      out[key] = redactFinanceTextForAi(out[key] as string);
    }
  }
  return out;
}

export function sanitizeFinanceWriteBody(body: Record<string, unknown>): Record<string, unknown> {
  return redactFinanceWriteFields(stripPaymentFields(body));
}

export function redactFinanceText(value: string | null | undefined): string {
  return redactFinanceTextForAi(value);
}
