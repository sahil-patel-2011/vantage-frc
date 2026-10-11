import type { GitHubPullDetail, GitHubPullFile } from "./pulls";

/**
 * Reviewing a pull request: which files go to the model, what it is asked, and which of its
 * findings are kept. Pure — no I/O — so every rule here is unit tested.
 *
 * A finding is kept only when its `quote` is a line the pull request adds (a "+" line of that
 * file's diff). A model that invents code, cites a file the PR does not touch, or quotes a
 * removed line has that finding dropped, and the drop is counted so the page can say so.
 */

export const PR_REVIEW_MAX_FILES = 25;
export const PR_REVIEW_FILE_PATCH_CHARS = 12_000;
export const PR_REVIEW_TOTAL_PATCH_CHARS = 60_000;
export const PR_REVIEW_MAX_FINDINGS = 12;

export type PrReviewRisk = "low" | "medium" | "high";
export type PrReviewSeverity = "high" | "medium" | "low";

export type PrReviewFinding = {
  file: string;
  line: number | null;
  severity: PrReviewSeverity;
  title: string;
  detail: string;
  quote: string;
};

export type PrReviewResult = {
  summary: string;
  risk: PrReviewRisk;
  findings: PrReviewFinding[];
  droppedUngrounded: number;
};

export type ReviewableFile = { filename: string; status: string; patch: string; truncated: boolean };
export type SkippedFile = { filename: string; reason: "removed" | "no_diff" | "not_code" | "generated" | "over_limit" };

const CODE_EXTENSIONS = /\.(java|kt|kts|py|cpp|cc|cxx|c|h|hpp|hh|ts|js|gradle|json|yaml|yml|toml|xml|cmake|txt|md)$/i;
const GENERATED_PATHS = /(^|\/)(build|bin|out|\.gradle|\.idea|\.vscode|node_modules|dist|__pycache__)\//;
const LOCKFILES = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|gradle\.lockfile|poetry\.lock)$/;

/** Robot code first (src/), then build and config files, each in GitHub's order. */
function priority(file: GitHubPullFile): number {
  if (/(^|\/)src\//.test(file.filename)) return 0;
  if (/\.(java|kt|py|cpp|cc|h|hpp)$/i.test(file.filename)) return 1;
  return 2;
}

export function selectReviewableFiles(files: GitHubPullFile[]): { reviewed: ReviewableFile[]; skipped: SkippedFile[] } {
  const reviewed: ReviewableFile[] = [];
  const skipped: SkippedFile[] = [];
  let total = 0;
  const ordered = files
    .map((file, index) => ({ file, index }))
    .sort((a, b) => priority(a.file) - priority(b.file) || a.index - b.index)
    .map(({ file }) => file);
  for (const file of ordered) {
    if (file.status === "removed") skipped.push({ filename: file.filename, reason: "removed" });
    else if (GENERATED_PATHS.test(file.filename) || LOCKFILES.test(file.filename)) skipped.push({ filename: file.filename, reason: "generated" });
    else if (!CODE_EXTENSIONS.test(file.filename)) skipped.push({ filename: file.filename, reason: "not_code" });
    else if (!file.patch) skipped.push({ filename: file.filename, reason: "no_diff" });
    else if (reviewed.length >= PR_REVIEW_MAX_FILES || total >= PR_REVIEW_TOTAL_PATCH_CHARS) skipped.push({ filename: file.filename, reason: "over_limit" });
    else {
      const room = Math.min(PR_REVIEW_FILE_PATCH_CHARS, PR_REVIEW_TOTAL_PATCH_CHARS - total);
      const truncated = file.patch.length > room;
      const patch = truncated ? file.patch.slice(0, room) : file.patch;
      total += patch.length;
      reviewed.push({ filename: file.filename, status: file.status, patch, truncated });
    }
  }
  return { reviewed, skipped };
}

export function prReviewContextItems(files: ReviewableFile[]) {
  return files.map((file, index) => ({
    type: "github_file" as const,
    id: `pr-diff:${file.filename}`,
    content: `[Pull request diff] ${file.filename} (${file.status}${file.truncated ? ", diff truncated" : ""})\n\`\`\`diff\n${file.patch}\n\`\`\``,
    // Earlier files are the robot code; keep them if the context budget runs short.
    importance: Math.max(1, 100 - index),
  }));
}

export function prReviewMessage(input: {
  repoFullName: string;
  pull: Pick<GitHubPullDetail, "number" | "title" | "authorLogin" | "baseRef" | "headRef">;
  files: ReviewableFile[];
  skipped: SkippedFile[];
  codeMap: string | null;
}): string {
  const lines = [
    `Review pull request #${input.pull.number} "${input.pull.title}" in ${input.repoFullName}` +
      (input.pull.baseRef ? ` (into ${input.pull.baseRef})` : "") +
      (input.pull.authorLogin ? `, opened by ${input.pull.authorLogin}` : "") +
      ". This is FIRST Robotics Competition robot code; a mistake can make a robot drive, spin or",
    "lift unexpectedly, so prefer one real problem over ten style notes.",
    "",
    "Look for, in this order: wrong motor or sensor CAN IDs, ports or inversions; unit mix-ups",
    "(rotations vs radians vs degrees, meters vs inches, percent vs volts); PID/feedforward sign or",
    "scale errors; commands missing addRequirements or conflicting default commands; blocking code",
    "in periodic loops (sleeps, while loops, network or file I/O); missing current limits, soft",
    "limits or brake mode on mechanisms; alliance-flipping and field-coordinate mistakes in autos;",
    "null or uninitialized hardware; then ordinary logic bugs. Ignore formatting and naming.",
    "",
    "Reply with JSON only, no prose around it:",
    '{"summary": "two sentences on what the PR does and whether it is safe to merge",',
    ' "risk": "low" | "medium" | "high",',
    ' "findings": [{"file": "path from the diff", "severity": "high" | "medium" | "low",',
    '   "title": "short problem name", "detail": "why it fails on the robot and the fix",',
    '   "quote": "one line copied exactly from an added (+) line of that file"}]}',
    `At most ${PR_REVIEW_MAX_FINDINGS} findings. Every quote must be copied from a + line of the diff above; findings without one are discarded. An empty findings list is a fine answer.`,
  ];
  if (input.skipped.length) {
    lines.push("", `Not shown (${input.skipped.length} files): ${input.skipped.slice(0, 12).map((s) => `${s.filename} (${s.reason})`).join(", ")}.`);
  }
  if (input.codeMap) lines.push("", "What the rest of the repo looks like:", input.codeMap);
  return lines.join("\n");
}

function normalize(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

/** Lines the diff adds, with their line number in the new file. */
export function addedLines(patch: string): Array<{ line: number; text: string }> {
  const out: Array<{ line: number; text: string }> = [];
  let next = 0;
  for (const raw of patch.split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      next = Number(hunk[1]);
      continue;
    }
    if (!next) continue;
    if (raw.startsWith("+") && !raw.startsWith("+++")) {
      out.push({ line: next, text: raw.slice(1) });
      next += 1;
    } else if (raw.startsWith("-") && !raw.startsWith("---")) {
      // removed line: not in the new file
    } else if (!raw.startsWith("\\")) {
      next += 1;
    }
  }
  return out;
}

function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = (fenced ? fenced[1] : text) ?? "";
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

function clip(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

export function parsePrReview(modelText: string, files: ReviewableFile[]): PrReviewResult {
  const parsed = extractJson(modelText) as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("The review did not come back in the expected format. Run it again.");
  }
  const risk: PrReviewRisk = parsed.risk === "high" || parsed.risk === "medium" ? parsed.risk : "low";
  const byFile = new Map(files.map((file) => [file.filename, addedLines(file.patch)]));
  const findings: PrReviewFinding[] = [];
  let dropped = 0;
  const raw = Array.isArray(parsed.findings) ? parsed.findings : [];
  for (const item of raw.slice(0, PR_REVIEW_MAX_FINDINGS * 2)) {
    if (!item || typeof item !== "object") {
      dropped += 1;
      continue;
    }
    const finding = item as Record<string, unknown>;
    const file = clip(finding.file, 300).replace(/^[ab]\//, "");
    const quote = clip(finding.quote, 400);
    const added = byFile.get(file);
    const match = added && quote ? added.find((entry) => normalize(entry.text) === normalize(quote) || (normalize(quote).length >= 12 && normalize(entry.text).includes(normalize(quote)))) : undefined;
    const title = clip(finding.title, 140);
    if (!match || !title) {
      dropped += 1;
      continue;
    }
    findings.push({
      file,
      line: match.line,
      severity: finding.severity === "high" || finding.severity === "medium" ? finding.severity : "low",
      title,
      detail: clip(finding.detail, 900),
      quote: normalize(match.text).slice(0, 400),
    });
    if (findings.length >= PR_REVIEW_MAX_FINDINGS) break;
  }
  const order: Record<PrReviewSeverity, number> = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  // A "low risk" answer with a high-severity finding is not low risk.
  const raised: PrReviewRisk = findings.some((f) => f.severity === "high") ? "high" : findings.some((f) => f.severity === "medium") && risk === "low" ? "medium" : risk;
  return {
    summary: clip(parsed.summary, 600) || "Reviewed.",
    risk: raised,
    findings,
    droppedUngrounded: dropped,
  };
}

/** A running review older than this is treated as stopped (the function timed out). */
export const PR_REVIEW_STALE_MS = 5 * 60_000;

export function reviewIsStale(status: string, updatedAt: string | Date, now = Date.now()): boolean {
  return status === "running" && now - new Date(updatedAt).getTime() > PR_REVIEW_STALE_MS;
}
