import type { GitHubTreeEntry } from "./api";

/**
 * A map of a team's robot code, built from the repository tree and a handful of small files,
 * with no AI. It is what Ask AI, the Build tools and pull request reviews know about the code
 * between scans: which subsystems and commands exist, which CAN IDs are assigned, which vendor
 * libraries and WPILib version the robot builds against. Pure — the caller fetches.
 */

export type CodeMapLanguage = "java" | "kotlin" | "cpp" | "python" | "mixed" | "unknown";

export type CodeMap = {
  version: 1;
  language: CodeMapLanguage;
  wpilibVersion: string | null;
  vendorLibraries: string[];
  subsystems: Array<{ name: string; path: string }>;
  commands: Array<{ name: string; path: string }>;
  canIds: Array<{ name: string; id: number; path: string }>;
  sourceFiles: number;
  treeTruncated: boolean;
};

const SOURCE = /\.(java|kt|cpp|cc|h|hpp|py)$/i;
const MAX_LISTED = 60;
/** Files read for the map: the build file and the constants files. */
export const CODE_MAP_MAX_FILE_READS = 6;

function baseName(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.[^.]+$/, "");
}

function isSource(entry: GitHubTreeEntry): boolean {
  return entry.type === "blob" && SOURCE.test(entry.path) && !/(^|\/)(build|bin|\.gradle|test|tests)\//.test(entry.path);
}

/** Which files to read: the GradleRIO build file and up to five constants files. */
export function codeMapFilesToRead(entries: GitHubTreeEntry[]): string[] {
  const wanted: string[] = [];
  const gradle = entries.find((e) => e.type === "blob" && /(^|\/)build\.gradle(\.kts)?$/.test(e.path) && !e.path.includes("/build/"));
  if (gradle) wanted.push(gradle.path);
  const constants = entries
    .filter((e) => isSource(e) && /(^|\/)(constants|robotmap|ports|ids)[^/]*\.(java|kt|py|h|hpp|cpp)$/i.test(e.path))
    .sort((a, b) => a.path.length - b.path.length)
    .slice(0, CODE_MAP_MAX_FILE_READS - wanted.length);
  wanted.push(...constants.map((e) => e.path));
  return wanted;
}

function languageOf(paths: string[]): CodeMapLanguage {
  const counts = { java: 0, kotlin: 0, cpp: 0, python: 0 };
  for (const path of paths) {
    if (/\.java$/i.test(path)) counts.java += 1;
    else if (/\.kt$/i.test(path)) counts.kotlin += 1;
    else if (/\.(cpp|cc|h|hpp)$/i.test(path)) counts.cpp += 1;
    else if (/\.py$/i.test(path)) counts.python += 1;
  }
  const ranked = Object.entries(counts).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return "unknown";
  const [top, second] = ranked;
  if (second && second[1] >= top![1] * 0.5) return "mixed";
  return top![0] as CodeMapLanguage;
}

/** `int kLeftLeaderId = 3;`, `LEFT_LEADER_CAN_ID = 3`, `constexpr int kIntakeID = 9;` → CAN-looking IDs. */
export function canIdsFrom(path: string, content: string): Array<{ name: string; id: number; path: string }> {
  const found: Array<{ name: string; id: number; path: string }> = [];
  const pattern = /\b([A-Za-z_][A-Za-z0-9_]*(?:ID|Id|_ID|CAN|Can)[A-Za-z0-9_]*)\s*(?::\s*[A-Za-z]+\s*)?=\s*(\d{1,2})\b/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content))) {
    const id = Number(match[2]);
    if (id >= 0 && id <= 62) found.push({ name: match[1]!, id, path });
    if (found.length >= 80) break;
  }
  return found;
}

export function buildCodeMap(input: { entries: GitHubTreeEntry[]; truncated: boolean; files: Record<string, string> }): CodeMap {
  const sources = input.entries.filter(isSource);
  const paths = sources.map((e) => e.path);
  const listed = (test: (path: string, name: string) => boolean) =>
    sources
      .filter((e) => test(e.path, baseName(e.path)))
      .map((e) => ({ name: baseName(e.path), path: e.path }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, MAX_LISTED);
  const subsystems = listed((path, name) => /(^|\/)subsystems?\//i.test(path) || /Subsystem$/.test(name)).filter((s) => !/^(Subsystem|SubsystemBase)$/.test(s.name));
  const commands = listed((path, name) => /(^|\/)commands?\//i.test(path) || /(Command|Cmd)$/.test(name));
  const vendorLibraries = input.entries
    .filter((e) => e.type === "blob" && /(^|\/)vendordeps\/[^/]+\.json$/i.test(e.path))
    .map((e) => baseName(e.path))
    .filter((name) => name !== "WPILibNewCommands")
    .sort();
  let wpilibVersion: string | null = null;
  const canIds: CodeMap["canIds"] = [];
  for (const [path, content] of Object.entries(input.files)) {
    if (/build\.gradle(\.kts)?$/.test(path)) {
      const version = /edu\.wpi\.first\.GradleRIO["']?\)?\s*version\s*["']([0-9][0-9A-Za-z.-]*)["']/.exec(content);
      if (version) wpilibVersion = version[1]!;
    } else {
      canIds.push(...canIdsFrom(path, content));
    }
  }
  return {
    version: 1,
    language: languageOf(paths),
    wpilibVersion,
    vendorLibraries,
    subsystems,
    commands,
    canIds: canIds.slice(0, 120),
    sourceFiles: sources.length,
    treeTruncated: input.truncated,
  };
}

/** CAN IDs used by more than one constant — a classic wiring bug. */
export function duplicateCanIds(map: CodeMap): Array<{ id: number; names: string[] }> {
  const byId = new Map<number, string[]>();
  for (const entry of map.canIds) byId.set(entry.id, [...(byId.get(entry.id) ?? []), entry.name]);
  return [...byId.entries()]
    .filter(([, names]) => new Set(names).size > 1)
    .map(([id, names]) => ({ id, names: [...new Set(names)] }))
    .sort((a, b) => a.id - b.id);
}

export type RecentPrReview = {
  number: number;
  title: string;
  risk: string | null;
  summary: string | null;
  findingCount: number;
  reviewedAt: string | null;
};

/** The compact text Ask AI and the Build tools are given. Bounded so it never crowds a turn. */
export function codeMapContext(input: {
  repoFullName: string;
  ref: string;
  headSha: string;
  generatedAt: string;
  map: CodeMap;
  reviews: RecentPrReview[];
}): string {
  const { map } = input;
  const names = (items: Array<{ name: string }>, max: number) =>
    items.length ? `${items.slice(0, max).map((i) => i.name).join(", ")}${items.length > max ? `, and ${items.length - max} more` : ""}` : "none found";
  const lines = [
    `[Robot code] ${input.repoFullName}@${input.ref} (commit ${input.headSha.slice(0, 7)}, mapped ${input.generatedAt.slice(0, 10)})`,
    `Language: ${map.language}. WPILib: ${map.wpilibVersion ?? "unknown"}. Vendor libraries: ${map.vendorLibraries.join(", ") || "none"}.`,
    `${map.sourceFiles} source files${map.treeTruncated ? " (tree truncated)" : ""}.`,
    `Subsystems (${map.subsystems.length}): ${names(map.subsystems, 30)}.`,
    `Commands (${map.commands.length}): ${names(map.commands, 30)}.`,
  ];
  if (map.canIds.length) {
    lines.push(`CAN IDs: ${map.canIds.slice(0, 40).map((c) => `${c.name}=${c.id}`).join(", ")}${map.canIds.length > 40 ? ", …" : ""}.`);
    const dupes = duplicateCanIds(map);
    if (dupes.length) lines.push(`Shared CAN IDs (check wiring): ${dupes.map((d) => `${d.id}: ${d.names.join(" / ")}`).join("; ")}.`);
  }
  if (input.reviews.length) {
    lines.push("Recent pull request reviews:");
    for (const review of input.reviews.slice(0, 5)) {
      lines.push(
        `- #${review.number} ${review.title} — ${review.risk ?? "not rated"} risk, ${review.findingCount} finding${review.findingCount === 1 ? "" : "s"}${review.summary ? `: ${review.summary.slice(0, 200)}` : ""}`,
      );
    }
  }
  return lines.join("\n").slice(0, 4_000);
}

/** Questions about the robot or its code get the code map; the rest of chat does not pay for it. */
export function wantsRobotCode(message: string): boolean {
  return /\b(code|coding|robot|subsystems?|commands?|motors?|can ?ids?|auto(n|nomous)?|swerve|drive(train)?|intake|shooter|arm|elevator|climb(er)?|wrist|pivot|indexer|feeder|turret|vision|odometry|pid|feedforward|wpilib|phoenix|revlib|talon|spark|kraken|neo|pull requests?|prs?|bugs?|deploy|build)\b/i.test(message);
}

const SAME_PART: string[][] = [
  ["drive", "drivetrain", "swerve", "tank", "chassis", "drivebase"],
  ["climb", "climber", "hang", "hanger"],
  ["vision", "camera", "cameras", "limelight", "photonvision"],
  ["elevator", "lift"],
];
const NOISE = new Set(["and", "the", "sub", "subsystem", "subsystems", "subsys", "system", "io", "real", "sim", "sensors", "mechanism"]);

function words(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !NOISE.has(word));
}

function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  return SAME_PART.some((group) => group.includes(a) && group.includes(b));
}

/**
 * Which file in the code map most likely holds a Robot Blueprint subsystem: "Drivetrain" →
 * SwerveSubsystem.java, "Climber" → ClimbSubsystem.java. Null when nothing matches or two files
 * match equally well ("Elevator / Arm" with both an Elevator and an Arm subsystem) — the team
 * picks then. A suggestion only; nothing is set until someone taps it.
 */
export function suggestCodeRef(subsystemName: string, candidates: Array<{ name: string; path: string }>, taken: Iterable<string> = []): string | null {
  const wanted = words(subsystemName);
  if (!wanted.length) return null;
  const used = new Set(Array.from(taken, (path) => path.trim().toLowerCase()).filter(Boolean));
  let best: { path: string; score: number } | null = null;
  let tied = false;
  for (const candidate of candidates) {
    if (used.has(candidate.path.toLowerCase())) continue;
    const have = words(candidate.name);
    let score = 0;
    for (const word of wanted) {
      if (have.some((other) => sameWord(word, other))) score = Math.max(score, 2);
      else if (have.some((other) => other.startsWith(word) || word.startsWith(other))) score = Math.max(score, 1);
    }
    if (!score) continue;
    if (!best || score > best.score) {
      best = { path: candidate.path, score };
      tied = false;
    } else if (score === best.score && candidate.path !== best.path) {
      tied = true;
    }
  }
  return best && !tied ? best.path : null;
}
