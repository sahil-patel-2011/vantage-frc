/**
 * Strip sensitive payment/identity patterns before any finance text reaches a model.
 * Allowed context: pricing, amounts, vendor/source, purpose/category — never bank
 * account numbers, full card numbers, routing numbers, or SSN.
 */

const SSN_RE = /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g;
const ROUTING_RE = /\b(?:routing|aba|rtn)[#:\s-]*\d{9}\b/gi;
const ROUTING_BARE_RE = /\b\d{9}\b/g;
const CARD_RE =
  /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6(?:011|5\d{2}))(?:[-\s]?\d{4}){3}\b|\b3[47]\d{2}(?:[-\s]?\d{6})(?:[-\s]?\d{5})\b/g;
const ACCOUNT_LABELED_RE =
  /\b(?:account|acct|bank\s*acct|iban)[#:\s.-]*([A-Z]{0,2}\d[\d\s-]{6,28}\d)\b/gi;
const LONG_DIGIT_RUN_RE = /\b\d[\d\s-]{10,28}\d\b/g;
const CVV_RE = /\b(?:cvv|cvc|cid|security\s*code)[#:\s-]*\d{3,4}\b/gi;

const REDACTED = "[REDACTED]";

/** Redact sensitive patterns from a single finance-related string. */
export function redactFinanceTextForAi(value: string | null | undefined): string {
  if (!value) return "";
  let text = value;
  text = text.replace(SSN_RE, REDACTED);
  text = text.replace(CVV_RE, REDACTED);
  text = text.replace(ROUTING_RE, REDACTED);
  text = text.replace(CARD_RE, REDACTED);
  text = text.replace(ACCOUNT_LABELED_RE, (_m, _acct) => `account ${REDACTED}`);
  // Bare long digit runs that look like account/card numbers (keep short amounts like 1234.56).
  text = text.replace(LONG_DIGIT_RUN_RE, (match) => {
    const digits = match.replace(/\D/g, "");
    if (digits.length >= 9 && digits.length <= 19) return REDACTED;
    return match;
  });
  // Standalone 9-digit runs near bank wording already handled; still scrub labeled routing leftovers.
  if (/\b(routing|aba|bank)\b/i.test(text)) {
    text = text.replace(ROUTING_BARE_RE, REDACTED);
  }
  return text;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Deep-sanitize finance payloads: redact string fields, drop known sensitive keys.
 * Amounts (numbers) and category/vendor labels pass through after text redaction.
 */
export function sanitizeFinancePayloadForAi<T>(value: T): T {
  const dropKeys = new Set([
    "accountnumber",
    "account_number",
    "bankaccount",
    "bank_account",
    "routingnumber",
    "routing_number",
    "routing",
    "iban",
    "swift",
    "bic",
    "cardnumber",
    "card_number",
    "pan",
    "cvv",
    "cvc",
    "ssn",
    "socialsecurity",
    "social_security",
    "taxid",
    "tax_id",
    "ein",
  ]);

  const walk = (node: unknown): unknown => {
    if (typeof node === "string") return redactFinanceTextForAi(node);
    if (Array.isArray(node)) return node.map(walk);
    if (!isPlainObject(node)) return node;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node)) {
      const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
      if (dropKeys.has(normalized)) {
        out[key] = REDACTED;
        continue;
      }
      out[key] = walk(child);
    }
    return out;
  };

  return walk(value) as T;
}

export const FINANCE_IN_AI_DENIED = {
  denied: true as const,
  setup_required: true as const,
  reason: "finance_in_ai.disabled" as const,
  message:
    "Finance-in-AI is off. An organization admin must enable “Allow AI to read team financial summaries” under Team → AI governance and accept the risks.",
};
