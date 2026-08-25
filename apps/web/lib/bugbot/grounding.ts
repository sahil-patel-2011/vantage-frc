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
