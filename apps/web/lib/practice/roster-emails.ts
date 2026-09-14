/**
 * Practice / attendance roster emails.
 *
 * Logistics never drop an address that is already on the list. Adding people
 * is a merge. Removing someone is a separate, explicit admin action — not
 * this helper.
 */

function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (!email || !email.includes("@") || email.length > 254) return null;
  return email;
}

export function mergePracticeRosterEmails(
  existing: readonly string[],
  incoming: readonly string[],
): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const raw of [...existing, ...incoming]) {
    const email = normalizeEmail(raw);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    merged.push(email);
  }
  return merged;
}
