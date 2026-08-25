/**
 * Release-notes composer — pure, no I/O.
 *
 * The pipeline (docs/RELEASING.md): an agent gathers real source material
 * (git log since the last release row, optional feature summaries), writes the
 * prose itself in the product register — short, confident, benefit-first, no
 * internal jargon — and this module turns that draft into the validated
 * structure the product_releases row stores. The quality lint is the contract:
 * notes that read like a commit log ("fixed bug", "misc", file paths,
 * first-person, hashes) are rejected, not published.
 *
 * Nothing here invents content: compose refuses to produce notes when there is
 * no source material, and every sentence comes from the calling agent.
 */

export type ReleaseSourceMaterial = {
  /** Version being released, e.g. "1.4.0" or "2026.2". */
  version: string;
  /** What actually changed since the last release. */
  since: {
    /** `git log --oneline` lines (or bare subjects) since the last release. Required, non-empty. */
    gitLog: string[];
    /** Optional human summaries of shipped features (workstream notes, PR bodies). */
    featureSummaries?: string[];
  };
};

export type ReleaseNotesDraft = {
  /** One confident sentence naming the release's biggest benefit. */
  headline: string;
  /** Benefit-first bullets. 1–5; the reader's gain leads, the mechanism follows. */
  highlights: string[];
  /** Smaller polish worth a line each. */
  improvements?: string[];
  /** What was broken and now works — named by symptom, never "fixed bug". */
  fixes?: string[];
  /** One-line email subject. Defaults to the headline, clipped. */
  emailSubject?: string;
};

export type ReleaseNotes = {
  version: string;
  headline: string;
  highlights: string[];
  improvements: string[];
  fixes: string[];
  emailSubject: string;
};

export type ComposeResult =
  | { ok: true; notes: ReleaseNotes }
  | { ok: false; problems: string[] };

export const RELEASE_HEADLINE_MAX = 90;
export const RELEASE_BULLET_MAX = 200;
export const RELEASE_EMAIL_SUBJECT_MAX = 78;
export const RELEASE_HIGHLIGHTS_MAX = 5;

/**
 * The quality lint. Each rule names what it rejects so a failing draft tells
 * the author exactly which sentence to rewrite.
 */
const BANNED: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\bfix(?:ed|es)?\s+(?:an?\s+|the\s+|some\s+)?bugs?\b/i,
    reason: `"fixed bug" says nothing — name the symptom that no longer happens`,
  },
  { pattern: /\bmisc(?:ellaneous)?\b/i, reason: `"misc" is filler — name the change or cut the line` },
  { pattern: /\bvarious\b/i, reason: `"various" is filler — name the change or cut the line` },
  {
    pattern: /\S+\/\S+\.(?:tsx?|jsx?|mjs|cjs|css|scss|sql|mdx?|json|ya?ml)\b/i,
    reason: "raw file paths are internal jargon — describe what the reader sees instead",
  },
  {
    pattern: /(?:^|[^\w'])(?:i|i've|i'm|i'd|we|we've|we're|we'd|our|ours|my|mine|us)(?=[^\w']|$)/i,
    reason: "first-person voice — release notes speak about the product, not the author",
  },
  {
    // Hex words 7–40 chars mixing digits and a–f letters: commit-hash shaped.
    // (Requiring both keeps plain numbers and rare all-letter words out.)
    pattern: /\b(?=[0-9a-f]{7,40}\b)(?=[0-9]*[a-f])(?=[a-f]*[0-9])[0-9a-f]+\b/i,
    reason: "commit hashes never belong in release notes",
  },
];

export type LintResult = { ok: true } | { ok: false; problems: string[] };

function lintLine(line: string, where: string, problems: string[]) {
  for (const rule of BANNED) {
    if (rule.pattern.test(line)) {
      problems.push(`${where}: ${rule.reason} — "${line.slice(0, 80)}"`);
    }
  }
}

/** Lint a full set of notes. Pure; safe to call on any draft, valid or not. */
export function lintReleaseNotes(notes: {
  headline: string;
  highlights: string[];
  improvements?: string[];
  fixes?: string[];
  emailSubject?: string;
}): LintResult {
  const problems: string[] = [];
  lintLine(notes.headline, "headline", problems);
  notes.highlights.forEach((line, i) => lintLine(line, `highlights[${i}]`, problems));
  (notes.improvements ?? []).forEach((line, i) => lintLine(line, `improvements[${i}]`, problems));
  (notes.fixes ?? []).forEach((line, i) => lintLine(line, `fixes[${i}]`, problems));
  if (notes.emailSubject) lintLine(notes.emailSubject, "emailSubject", problems);
  return problems.length ? { ok: false, problems } : { ok: true };
}

/** Strip a leading `git log --oneline` hash so raw lines can seed a draft. */
export function stripCommitHash(line: string): string {
  return line.replace(/^\s*[0-9a-f]{7,40}\s+/i, "").trim();
}

export type ClassifiedCommits = {
  features: string[];
  improvements: string[];
  fixes: string[];
};

/**
 * Bucket raw git-log lines into candidate material for the three sections.
 * These are *inputs to the author*, never publishable prose — subjects keep
 * engineer voice and will fail the lint until rewritten benefit-first.
 */
export function classifyCommitLines(gitLog: string[]): ClassifiedCommits {
  const out: ClassifiedCommits = { features: [], improvements: [], fixes: [] };
  const seen = new Set<string>();
  for (const raw of gitLog) {
    const subject = stripCommitHash(raw);
    if (!subject || /^merge\b/i.test(subject)) continue;
    const key = subject.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (/\bfix(?:es|ed)?\b|\bbug\b|\bregression\b|\bcrash\b/i.test(subject)) {
      out.fixes.push(subject);
    } else if (/^(?:add|introduce|launch|create|new)\b|\bnew\b|\bfeature\b/i.test(subject)) {
      out.features.push(subject);
    } else {
      out.improvements.push(subject);
    }
  }
  return out;
}

function cleanList(lines: string[] | undefined, where: string, problems: string[]): string[] {
  const cleaned = (lines ?? []).map((line) => line.trim()).filter(Boolean);
  for (const line of cleaned) {
    if (line.length > RELEASE_BULLET_MAX) {
      problems.push(`${where}: keep each line under ${RELEASE_BULLET_MAX} characters — "${line.slice(0, 60)}…"`);
    }
    if (/\n/.test(line)) problems.push(`${where}: one line per bullet — no embedded newlines`);
  }
  return cleaned;
}

/**
 * Validate a draft against its source material and produce the final structure.
 * Refuses to compose when there is nothing real to release (empty git log).
 */
export function composeReleaseNotes(
  material: ReleaseSourceMaterial,
  draft: ReleaseNotesDraft,
): ComposeResult {
  const problems: string[] = [];

  const version = material.version.trim();
  if (!/^\d+[\w.-]*$/.test(version)) {
    problems.push(`version: "${material.version}" — use a plain version like "1.4.0" or "2026.2"`);
  }

  const gitLog = material.since.gitLog.map((line) => line.trim()).filter(Boolean);
  if (gitLog.length === 0) {
    problems.push("since.gitLog: empty — release notes must describe real changes, never be invented");
  }

  const headline = draft.headline.trim();
  if (!headline) problems.push("headline: required");
  if (headline.length > RELEASE_HEADLINE_MAX) {
    problems.push(`headline: keep it under ${RELEASE_HEADLINE_MAX} characters`);
  }

  const highlights = cleanList(draft.highlights, "highlights", problems);
  if (highlights.length === 0) problems.push("highlights: at least one benefit-first highlight is required");
  if (highlights.length > RELEASE_HIGHLIGHTS_MAX) {
    problems.push(`highlights: at most ${RELEASE_HIGHLIGHTS_MAX} — a release with ten highlights has none`);
  }
  const improvements = cleanList(draft.improvements, "improvements", problems);
  const fixes = cleanList(draft.fixes, "fixes", problems);

  let emailSubject = (draft.emailSubject ?? headline).trim();
  if (/\n/.test(emailSubject)) problems.push("emailSubject: one line only");
  emailSubject = emailSubject.replace(/\s+/g, " ");
  if (emailSubject.length > RELEASE_EMAIL_SUBJECT_MAX) {
    problems.push(`emailSubject: keep it under ${RELEASE_EMAIL_SUBJECT_MAX} characters`);
  }

  const lint = lintReleaseNotes({ headline, highlights, improvements, fixes, emailSubject });
  if (!lint.ok) problems.push(...lint.problems);

  if (problems.length) return { ok: false, problems };
  return {
    ok: true,
    notes: { version, headline, highlights, improvements, fixes, emailSubject },
  };
}

/**
 * Render the structure as the notes_markdown a product_releases row stores.
 * /whats-new shows this text verbatim (pre-wrapped), so it stays plain and short.
 */
export function releaseNotesToMarkdown(notes: ReleaseNotes): string {
  const parts: string[] = [notes.headline, ""];
  parts.push("Highlights");
  for (const line of notes.highlights) parts.push(`• ${line}`);
  if (notes.improvements.length) {
    parts.push("", "Improvements");
    for (const line of notes.improvements) parts.push(`• ${line}`);
  }
  if (notes.fixes.length) {
    parts.push("", "Fixes");
    for (const line of notes.fixes) parts.push(`• ${line}`);
  }
  return parts.join("\n").trim();
}
