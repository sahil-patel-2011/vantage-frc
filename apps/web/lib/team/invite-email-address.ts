/**
 * One check for an invite address, used by Team admin's form and by the invites API, so the
 * two never disagree. "qa3-ünï@example.test" passed the form and came back from the server as
 * "Request fields are invalid."; a 312-character address did the same.
 */

const MAX_EMAIL_LENGTH = 254;
const SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// What the server can actually send to: ASCII letters, digits and the usual punctuation, with a
// dotted domain. Unicode addresses exist, but no provider set up here delivers to them reliably.
const SENDABLE = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;

/** Null when the address can be invited, else a sentence that names it and says what to fix. */
export function inviteEmailProblem(address: string): string | null {
  const value = address.trim();
  if (!value) return "Enter an email address.";
  if (value.length > MAX_EMAIL_LENGTH) return `"${value.slice(0, 40)}…" is too long for an email address.`;
  if (!SHAPE.test(value)) return `"${value}" isn't a full email address, like name@school.org.`;
  // eslint-disable-next-line no-control-regex
  if (/[^\x00-\x7F]/.test(value)) {
    return `"${value}" has letters we can't send email to. Use a plain address with a–z, 0–9 and . - _ only.`;
  }
  if (value.includes("..") || value.startsWith(".") || value.split("@")[0]!.endsWith(".") || !SENDABLE.test(value)) {
    return `"${value}" isn't a full email address, like name@school.org.`;
  }
  return null;
}

/** Split a pasted list (commas, spaces, semicolons, new lines) into addresses, keeping order, once each. */
export function splitInviteEmails(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of text.split(/[\s,;]+/)) {
    const value = entry.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}
