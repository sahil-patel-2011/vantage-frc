/**
 * Keep payment cards out of the vendor directory (docs/FINANCE_SECURITY.md, F2).
 *
 * `vendors.account_number` is a team's customer reference with a supplier
 * ("AndyMark acct 104233"), readable by every member. A card number pasted there,
 * or into the notes, would sit in plain text. The finance redactor is too blunt for
 * this field — it removes any long digit run, which is exactly what a supplier
 * account reference or a phone number is — so this checks for what actually matters:
 * a 13–19 digit run that passes the Luhn checksum every payment card carries, and a
 * labelled security code.
 */

const DIGIT_RUN_RE = /\d(?:[ -]?\d){12,18}/g;
const CVV_RE = /\b(?:cvv|cvc|cid|security\s*code)[#:\s-]*\d{3,4}\b/gi;

export function luhnValid(digits: string): boolean {
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let value = Number(digits[index]);
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

function cardRuns(text: string): string[] {
  return (text.match(DIGIT_RUN_RE) ?? []).filter((run) => luhnValid(run.replace(/\D/g, "")));
}

export function containsPaymentCard(text: string | null | undefined): boolean {
  return Boolean(text) && cardRuns(text!).length > 0;
}

export class VendorPaymentDataError extends Error {
  constructor() {
    super(
      "That looks like a payment card number. Store your account reference with the supplier here, never a card or bank number.",
    );
    this.name = "VendorPaymentDataError";
  }
}

/** The account-number field is refused outright: there is no safe partial value to keep. */
export function guardVendorAccountNumber(value: string | null | undefined): string | null | undefined {
  if (value && (containsPaymentCard(value) || CVV_RE.test(value))) {
    CVV_RE.lastIndex = 0;
    throw new VendorPaymentDataError();
  }
  CVV_RE.lastIndex = 0;
  return value;
}

/** Notes keep everything else a person wrote; only the card number and security code go. */
export function redactVendorNotes(value: string | null | undefined): string | null | undefined {
  if (!value) return value;
  let text = value;
  for (const run of cardRuns(text)) text = text.split(run).join("[card number removed]");
  return text.replace(CVV_RE, "[security code removed]");
}
