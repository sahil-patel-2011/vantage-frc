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

export type ServerBugbotSource = {
  path: string;
  contentSha256: string;
  githubRepo: string | null;
  githubSha: string | null;
};

export function assertBugbotPhaseGrounding(input: {
  phase: "scan" | "fix" | "recheck";
  source: ServerBugbotSource;
  parent: ServerBugbotSource | null;
}): void {
  if (input.phase === "scan") return;
  if (!input.parent) {
    throw new Error(`${input.phase} requires a grounded parent Bugbot review`);
  }
  const { source, parent } = input;
  if (parent.githubRepo) {
    if (source.githubRepo?.toLowerCase() !== parent.githubRepo.toLowerCase()) {
      throw new Error(`${input.phase} source does not match the repository that was scanned`);
    }
    if (!asCommitSha(source.githubSha)) {
      throw new Error(`${input.phase} requires source resolved to a full GitHub commit SHA`);
    }
    if (input.phase === "fix") {
      const scannedSha = asCommitSha(parent.githubSha);
      if (!scannedSha || source.githubSha !== scannedSha) {
        throw new Error("fix source is not pinned to the commit that was scanned");
      }
    }
    return;
  }
  if (source.githubRepo) {
    throw new Error(`${input.phase} cannot retarget a buffer review to a repository`);
  }
  if (source.path !== parent.path) {
    throw new Error(`${input.phase} source path does not match the buffer that was scanned`);
  }
  if (input.phase === "fix" && source.contentSha256 !== parent.contentSha256) {
    throw new Error("fix source content does not match the buffer that was scanned");
  }
}

/** Rebuild the last-scan target from a persisted review — never from the editor textarea. */
export function lastScanFromReview(review: {
  githubRepo?: string | null;
  githubRef?: string | null;
  githubSha?: string | null;
} | null): BugbotScanTarget | null {
  if (!review) return null;
  if (review.githubRepo?.trim()) {
    return {
      scanRepo: true,
      repo: review.githubRepo.trim(),
      ref: review.githubRef?.trim() || null,
      sha: asCommitSha(review.githubSha),
    };
  }
  return { scanRepo: false, repo: null, ref: null, sha: null };
}
