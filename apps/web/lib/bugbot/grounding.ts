/**
 * Bugbot fix grounding.
 *
 * After a repo scan, the paid fix/recheck must run against the repo content
 * that was actually scanned — pinned to its commit sha — never the editor
 * buffer, which may hold the teaching sample or an unrelated pasted file.
 * Editor-paste scans (no repo scan) keep buffer behaviour: the buffer IS the
 * scanned source there.
 */

export type BugbotScanTarget = {
  scanRepo: boolean;
  repo: string | null;
  ref: string | null;
  sha: string | null;
};

/** Full 40-hex GitHub commit sha, normalized to lowercase; null otherwise. */
export function asCommitSha(value?: string | null): string | null {
  const raw = value?.trim().toLowerCase() ?? "";
  return /^[0-9a-f]{40}$/.test(raw) ? raw : null;
}

/**
 * Decide what a Bugbot request runs against.
 * - scan: whatever the caller asked (connected repo or the editor buffer).
 * - fix: if the last scan was a repo scan, target the repo pinned to the
 *   scanned sha so the $2 fix is grounded in the exact content that produced
 *   the findings.
 * - recheck: if the last scan was a repo scan, re-scan the repo at the current
 *   head (fresh sha) — the team may have pushed the approved fix since.
 */
export function resolveBugbotTarget(input: {
  phase: "scan" | "fix" | "recheck";
  scanRepoRequested: boolean;
  lastScan: BugbotScanTarget | null;
}): { useRepo: boolean; repo: string | null; ref: string | null; pinnedSha: string | null } {
  if (input.phase === "scan") {
    return { useRepo: input.scanRepoRequested, repo: null, ref: null, pinnedSha: null };
  }
  const last = input.lastScan;
  if (!last?.scanRepo) {
    return { useRepo: false, repo: null, ref: null, pinnedSha: null };
  }
  return {
    useRepo: true,
    repo: last.repo,
    ref: last.ref,
    pinnedSha: input.phase === "fix" ? asCommitSha(last.sha) : null,
  };
}

/* ------------------------------------------------------------------ *
 * Per-finding targeting.
 *
 * A repo scan is several chunks. A paid fix or recheck for one finding must
 * re-read the FILE that owns the finding — never "chunk 0" by default — and
 * must only carry the findings that live in that file. Both halves are pure
 * so the billing-correctness rule is a test, not a comment.
 * ------------------------------------------------------------------ */

/** Repo-relative path, forward slashes, no leading slash. Empty for unsafe input. */
export function normaliseBugbotPath(path: string | null | undefined): string {
  const clean = String(path ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  if (!clean || clean.includes("..")) return "";
  return clean.slice(0, 400);
}

/** The file a finding lives in: its filePath, else the path half of `path:line`. */
export function bugbotFindingFile(finding: { filePath?: string | null; location: string }): string {
  if (finding.filePath) return normaliseBugbotPath(finding.filePath);
  return normaliseBugbotPath(finding.location.replace(/:\d+$/, ""));
}

export type BugbotFileTarget = {
  filePath: string;
  /** The planned chunk that owns the file, or null when the plan does not list it. */
  chunkIndex: number | null;
};

/**
 * Which planned chunk owns `filePath`. The client's chunk hint is only trusted
 * when the server-side plan agrees; an unlisted file (deferred past the budget,
 * or the plan changed) still targets the file itself with no chunk claim.
 */
export function resolveBugbotFileTarget(input: {
  chunks: string[][];
  filePath?: string | null;
  chunkHint?: number | null;
}): BugbotFileTarget | null {
  const filePath = normaliseBugbotPath(input.filePath);
  if (!filePath) return null;
  const wanted = filePath.toLowerCase();
  const owns = (chunk: string[] | undefined) =>
    Boolean(chunk?.some((path) => normaliseBugbotPath(path).toLowerCase() === wanted));
  const hint = Number.isInteger(input.chunkHint) ? Number(input.chunkHint) : null;
  if (hint != null && hint >= 0 && owns(input.chunks[hint])) return { filePath, chunkIndex: hint };
  const found = input.chunks.findIndex((chunk) => owns(chunk));
  return { filePath, chunkIndex: found >= 0 ? found : null };
}

/** Only the findings that live in `filePath` — a fix must never be asked to address another file's findings. */
export function filterBugbotFindingsToFile<T extends { filePath?: string | null; location: string }>(
  findings: T[],
  filePath: string,
): T[] {
  const wanted = normaliseBugbotPath(filePath).toLowerCase();
  if (!wanted) return [];
  return findings.filter((finding) => bugbotFindingFile(finding).toLowerCase() === wanted);
}
