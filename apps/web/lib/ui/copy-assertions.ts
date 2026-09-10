/**
 * Shared assertion for copy a student or mentor reads.
 *
 * Many feature tests used to pin the disclaimer sentence itself — asserting
 * that an empty state said "never DEMO classmates" or "org-scoped". That made
 * the internal vocabulary a requirement. The check here is the opposite and
 * strictly stronger: the copy must exist, read as a sentence, and contain none
 * of that vocabulary.
 *
 * Test-only. Nothing in the app imports this, so it never reaches the bundle.
 */

const BANNED: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bDEMO\b/, "engineering shorthand for placeholder data"],
  [/\bnever\s+invent(s|ed|ing)?\b/i, "a promise of honesty tells the reader nothing to do"],
  [/\bsoft[-\s]?ui\b/i, "internal design-system codename"],
  [/\borg[-\s]scoped\b/i, "tenancy jargon"],
  [/\bRLS\b/, "database vocabulary"],
  [/\brow[-\s]level\s+security\b/i, "database vocabulary"],
  [/\bsetup_required\b/, "an API state name, not a sentence"],
  [/\bpre-seeded\b/i, "describes how the table was populated, not what to do"],
  [/\bfixtures?\b/i, "test vocabulary"],
  [/\bhard\s+usage\s+cut[-\s]?offs?\b/i, "billing internals"],
  [/\bPAYG\b/, 'billing jargon — say "pay-as-you-go"'],
  [/\bBYOK\b/, 'billing jargon — say "your own keys"'],
  [/\bkill\s+switch\b/i, 'billing internals — say "pause Chat"'],
  [/\ballowlist(?:s|ed)?\b/i, 'say what is allowed, not "allowlist"'],
  [
    /\bopen your workspace\b|\bmore than one workspace\b|\bworkspace membership\b|\bteam workspaces\b|\bworkspace inventory\b|\b(connect|set|finish)\s+workspace\b|\bjoin workspace\b|\bopen workspace\b|\bin workspace\b|\bfrom workspace\b|\bcheck workspace\b|\bcross-check workspace\b|\bworkspace created\b|\bworkspace picks\b|\bworkspace\s*→/i,
    'say "team"',
  ],
  [
    /\b(no|never|zero|without)\s+(any\s+)?(placeholder|demo|fake|synthetic|mock|dummy|sample|invented|fabricated)\s+(data|numbers?|metrics?|rows?|values?|names?|stats?|figures?|dollars?|hours?|logos?|slots?|lessons?)\b/i,
    "a disclaimer that the data is real",
  ],
];

/** Returns a human-readable problem with this copy, or null when it is fine. */
export function copyProblem(text: unknown): string | null {
  if (typeof text !== "string") return `expected a string of copy, got ${typeof text}`;
  const trimmed = text.trim();
  if (trimmed.length < 12) return `too short to tell the reader anything: ${JSON.stringify(text)}`;
  for (const [pattern, why] of BANNED) {
    const match = pattern.exec(trimmed);
    if (match) return `"${match[0]}" is ${why} — in ${JSON.stringify(trimmed)}`;
  }
  return null;
}

/**
 * Asserts a string is copy a reader can act on: present, long enough to say
 * something, and free of internal engineering vocabulary.
 */
export function expectPlainCopy(text: unknown): void {
  const problem = copyProblem(text);
  if (problem) throw new Error(`Copy shown to a user is wrong — ${problem}`);
}
