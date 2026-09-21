/**
 * One canonical shape for every release note, so an AI agent (Cursor, Claude
 * Code, the desktop updater) publishes the same format every time: a short
 * plain-language headline, then "New", "Better", "Fixed" bullets.
 *
 * The composer is deliberately strict and boring — it strips the technical
 * residue agents tend to paste (commit hashes, file paths, backticks, PR refs),
 * keeps bullets short, and caps how much lands in one release. No AI call, no
 * network: pure text in, markdown out.
 */

export const RELEASE_SECTIONS = [
  { key: "added", heading: "New" },
  { key: "improved", heading: "Better" },
  { key: "fixed", heading: "Fixed" },
] as const;

export type ReleaseSectionKey = (typeof RELEASE_SECTIONS)[number]["key"];

export const RELEASE_BULLET_MAX_CHARS = 110;
export const RELEASE_BULLETS_PER_SECTION = 6;
export const RELEASE_HEADLINE_MAX_CHARS = 140;

export type ComposeReleaseNotesInput = {
  /** Public version label, e.g. "2026.3" or "v1.4.0". */
  version: string;
  /** One sentence a non-technical user understands. */
  headline: string;
  added?: string[];
  improved?: string[];
  fixed?: string[];
};

export type ComposedReleaseNotes = {
  slug: string;
  title: string;
  versionLabel: string;
  headline: string;
  sections: Array<{ key: ReleaseSectionKey; heading: string; items: string[] }>;
  notesMarkdown: string;
};

/** Jargon an agent writes but a student user should never have to read. */
const TECHNICAL_NOISE = [
  /\((?:[0-9a-f]{7,40})\)/gi, // (abc1234) commit shas
  /\b[0-9a-f]{7,40}\b(?=\s*$)/gi, // trailing bare sha
  /\((?:#\d+)\)|\s#\d+\b/g, // PR/issue refs
  /\b(?:refs?|closes|fixes)\s+#\d+/gi,
  /\b[\w./-]+\.(?:ts|tsx|js|jsx|css|sql|json|mjs)\b/gi, // file paths
  /`+/g,
];

const PREFIX_NOISE = /^(?:feat|fix|chore|refactor|perf|docs|test|build|ci|style)(?:\([^)]*\))?:\s*/i;

function cleanLine(raw: string): string {
  let text = raw.replace(/^[\s*\-–•]+/, "").trim();
  text = text.replace(PREFIX_NOISE, "");
  for (const pattern of TECHNICAL_NOISE) text = text.replace(pattern, " ");
  text = text.replace(/\s+/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
  text = text.replace(/[.\s]+$/, "");
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const clipped = text.slice(0, max - 1);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`;
}

function cleanBullets(values: string[] | undefined): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const value of values ?? []) {
    const text = truncate(cleanLine(String(value)), RELEASE_BULLET_MAX_CHARS);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    items.push(text);
    if (items.length >= RELEASE_BULLETS_PER_SECTION) break;
  }
  return items;
}

export function normalizeVersionLabel(version: string): string {
  const label = version.trim().replace(/^v\s*/i, "v").replace(/\s+/g, "");
  if (!/^v?[0-9][0-9A-Za-z.\-+]*$/.test(label)) {
    throw new Error("version must look like a version number, e.g. 2026.3 or v1.4.0");
  }
  return label;
}

export function releaseSlugForVersion(version: string): string {
  return `release-${normalizeVersionLabel(version)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")}`;
}

/** Compose the canonical release note. Throws when there is nothing to ship. */
export function composeReleaseNotes(input: ComposeReleaseNotesInput): ComposedReleaseNotes {
  const versionLabel = normalizeVersionLabel(input.version);
  const headline = truncate(cleanLine(input.headline ?? ""), RELEASE_HEADLINE_MAX_CHARS);
  if (!headline) throw new Error("headline is required");

  const sections = RELEASE_SECTIONS.map((section) => ({
    key: section.key,
    heading: section.heading,
    items: cleanBullets(input[section.key]),
  })).filter((section) => section.items.length > 0);

  if (sections.length === 0) {
    throw new Error("at least one added, improved, or fixed item is required");
  }

  const notesMarkdown = [
    `${headline}.`,
    ...sections.map((section) =>
      [`**${section.heading}**`, ...section.items.map((item) => `- ${item}`)].join("\n"),
    ),
  ].join("\n\n");

  return {
    slug: releaseSlugForVersion(versionLabel),
    title: `Vantage ${versionLabel}`,
    versionLabel,
    headline,
    sections,
    notesMarkdown,
  };
}
