/**
 * Honest "what is this repo?" note for Bugbot.
 *
 * Built from paths the scan already saw plus a few well-known files (README,
 * WPILib prefs, Gradle). Never invents a team number, year, or mechanism.
 */

export const REPO_OVERVIEW_PATHS = [
  "README.md",
  "README",
  "readme.md",
  ".wpilib/wpilib_preferences.json",
  "wpilib_preferences.json",
  "build.gradle",
  "settings.gradle",
  "pyproject.toml",
  "vendordeps",
] as const;

export type RepoOverviewFile = { path: string; content: string };

export type RepoOverviewInput = {
  repo?: string | null;
  description?: string | null;
  paths?: readonly string[];
  files?: readonly RepoOverviewFile[];
};

const LANG_EXT: Array<{ ext: RegExp; label: string }> = [
  { ext: /\.java$/i, label: "Java" },
  { ext: /\.(cpp|cc|h|hpp)$/i, label: "C++" },
  { ext: /\.py$/i, label: "Python" },
  { ext: /\.kt$/i, label: "Kotlin" },
];

function cleanPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function languagesFromPaths(paths: readonly string[]): string[] {
  const found = new Set<string>();
  for (const path of paths) {
    for (const row of LANG_EXT) {
      if (row.ext.test(path)) found.add(row.label);
    }
  }
  return [...found];
}

function rolesFromPaths(paths: readonly string[]): string[] {
  const roles: string[] = [];
  const joined = paths.map(cleanPath);
  if (joined.some((path) => /(^|\/)(Robot|Main)\.(java|kt|cpp|cc|h|py)$/i.test(path) || /\/robot\.py$/i.test(path))) {
    roles.push("WPILib robot entry point");
  }
  if (joined.some((path) => /RobotContainer\./i.test(path))) roles.push("RobotContainer");
  if (joined.some((path) => /(^|\/)subsystems?(\/|$)|Subsystem\./i.test(path))) roles.push("subsystems");
  if (joined.some((path) => /(^|\/)commands?(\/|$)|Command\./i.test(path))) roles.push("commands");
  if (joined.some((path) => /(^|\/)vendordeps(\/|$)/i.test(path))) roles.push("vendordeps present (not scanned)");
  return roles;
}

function firstParagraph(markdown: string): string | null {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const bits: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (bits.length) break;
      continue;
    }
    if (/^```/.test(trimmed)) break;
    if (/^#+\s/.test(trimmed)) {
      if (bits.length) break;
      bits.push(trimmed.replace(/^#+\s+/, ""));
      continue;
    }
    bits.push(trimmed.replace(/^[-*]\s+/, ""));
    if (bits.join(" ").length > 280) break;
  }
  const text = bits.join(" ").replace(/\s+/g, " ").trim();
  if (!text || /\bdemo\b/i.test(text)) return null;
  return text.slice(0, 280);
}

function wpilibYear(content: string): string | null {
  const match = content.match(/"projectYear"\s*:\s*"(\d{4})"/);
  return match?.[1] ?? null;
}

/**
 * Build a short overview, or null when there is nothing honest to say.
 */
export function buildRepoOverview(input: RepoOverviewInput): string | null {
  const paths = (input.paths ?? []).map(cleanPath).filter(Boolean);
  const files = (input.files ?? []).filter((file) => file.content.trim());
  const lines: string[] = [];

  const pin = input.repo?.trim();
  if (pin) lines.push(`Repo ${pin}`);

  const description = input.description?.replace(/\s+/g, " ").trim();
  if (description && !/\bdemo\b/i.test(description)) {
    lines.push(description.slice(0, 180));
  }

  const langs = languagesFromPaths(paths.length ? paths : files.map((file) => file.path));
  if (langs.length) lines.push(`Languages seen: ${langs.join(", ")}`);

  const roles = rolesFromPaths(paths.length ? paths : files.map((file) => file.path));
  if (roles.length) lines.push(roles.join("; "));

  for (const file of files) {
    const path = cleanPath(file.path);
    if (/(^|\/)readme(\.md)?$/i.test(path)) {
      const paragraph = firstParagraph(file.content);
      if (paragraph) lines.push(`README: ${paragraph}`);
    }
    if (/wpilib_preferences\.json$/i.test(path)) {
      const year = wpilibYear(file.content);
      if (year) lines.push(`WPILib project year ${year}`);
    }
    if (/build\.gradle$/i.test(path) && /edu\.wpi\.first/i.test(file.content)) {
      lines.push("Gradle WPILib build");
    }
  }

  if (lines.length <= (pin ? 1 : 0)) return null;
  return lines.join("\n");
}

export function isRepoOverviewPath(path: string): boolean {
  const clean = cleanPath(path);
  return REPO_OVERVIEW_PATHS.some((name) => clean === name || clean.endsWith(`/${name}`));
}
