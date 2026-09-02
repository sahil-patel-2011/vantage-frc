/**
 * Merging a chunked Bugbot scan into one honest result.
 *
 * A repo scan is several metered calls (one per planned chunk). The team sees a
 * single findings table, so the chunk outcomes have to be merged — and the merge
 * is where partial coverage either gets reported or silently disappears. This is
 * pure logic on purpose: the rule "a run that did not finish every chunk is
 * PARTIAL, and says so" is a test, not a comment.
 *
 * Never invents coverage: `reviewedFiles` is the union of what the chunks
 * actually read, never the plan's intention.
 */

export type ScanSkipRecord = { path: string; reason: string };
export type ScanSkipCount = { reason: string; label: string; count: number };

export type BugbotRunFinding = {
  severity: "high" | "medium" | "low";
  location: string;
  line: number;
  finding: string;
  evidence: string;
  source: "local_rule" | "model";
  pattern?: string;
  filePath?: string;
  fingerprint?: string;
  delta?: "new" | "known" | "fixed";
};

export type BugbotRunFixedFinding = {
  fingerprint: string;
  filePath: string;
  rule: string;
  finding: string;
};

/** One metered chunk's response, narrowed to what the merge needs. */
export type BugbotChunkOutcome = {
  chunkIndex: number;
  path: string;
  findings: BugbotRunFinding[];
  droppedUngrounded: number;
  chargeUsd: number;
  reviewedFiles: string[];
  skipped: ScanSkipRecord[];
  skipCounts: ScanSkipCount[];
  candidateCount: number;
  deferredCount: number;
  treeTruncated: boolean;
  skippedListTruncated: boolean;
  /** Files whose tail was cut at a read cap in this chunk. */
  truncatedFiles?: string[];
  newCount: number;
  knownCount: number;
  fixedCount: number;
  fixedFindings: BugbotRunFixedFinding[];
};

export type BugbotRunResult = {
  path: string;
  riskLevel: "high" | "medium" | "low";
  findings: BugbotRunFinding[];
  localRiskCount: number;
  modelFindingCount: number;
  droppedUngrounded: number;
  reviewedFiles: string[];
  skipped: ScanSkipRecord[];
  skipCounts: ScanSkipCount[];
  candidateCount: number;
  deferredCount: number;
  treeTruncated: boolean;
  skippedListTruncated: boolean;
  /** True when any file in any chunk was cut at a read cap. */
  truncated: boolean;
  truncatedFiles: string[];
  chunksRun: number;
  chunkCount: number;
  spentUsd: number;
  newCount: number;
  knownCount: number;
  fixedCount: number;
  fixedFindings: BugbotRunFixedFinding[];
  /** True whenever this run does NOT amount to full coverage of the repo. */
  partial: boolean;
  partialReason: string | null;
};

const SEVERITY_RANK: Record<"high" | "medium" | "low", number> = { high: 3, medium: 2, low: 1 };

/** Stable identity for the merged table: the fingerprint when we have one. */
function findingKey(finding: BugbotRunFinding): string {
  return finding.fingerprint ?? `${finding.location}|${finding.finding}`;
}

/**
 * Merge the chunks that ran into one result.
 *
 * `plannedChunks` is what the free plan said the repo needs; `stoppedReason` is
 * set when the run ended early (budget cutoff, error, user stop). Either a short
 * run or a deferred file count makes the whole result PARTIAL — a scan that read
 * 8 of 41 files must never render as a clean bill of health.
 */
export function mergeBugbotScanRun(
  outcomes: BugbotChunkOutcome[],
  options: { plannedChunks: number; stoppedReason?: string | null },
): BugbotRunResult {
  const plannedChunks = Math.max(1, Math.floor(options.plannedChunks) || 1);
  const findings: BugbotRunFinding[] = [];
  const seen = new Set<string>();
  const reviewedFiles: string[] = [];
  const reviewedSeen = new Set<string>();
  const skipped: ScanSkipRecord[] = [];
  const skippedSeen = new Set<string>();
  const fixedFindings: BugbotRunFixedFinding[] = [];
  const fixedSeen = new Set<string>();
  const truncatedFiles: string[] = [];
  const truncatedSeen = new Set<string>();
  let skipCounts: ScanSkipCount[] = [];
  let droppedUngrounded = 0;
  let spentUsd = 0;
  let candidateCount = 0;
  let deferredCount = 0;
  let treeTruncated = false;
  let skippedListTruncated = false;
  let newCount = 0;
  let knownCount = 0;
  let fixedCount = 0;

  for (const outcome of outcomes) {
    for (const finding of outcome.findings) {
      const key = findingKey(finding);
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push(finding);
    }
    for (const file of outcome.reviewedFiles) {
      if (reviewedSeen.has(file)) continue;
      reviewedSeen.add(file);
      reviewedFiles.push(file);
    }
    for (const record of outcome.skipped) {
      if (skippedSeen.has(record.path)) continue;
      skippedSeen.add(record.path);
      skipped.push(record);
    }
    for (const fixed of outcome.fixedFindings) {
      if (fixedSeen.has(fixed.fingerprint)) continue;
      fixedSeen.add(fixed.fingerprint);
      fixedFindings.push(fixed);
    }
    for (const file of outcome.truncatedFiles ?? []) {
      if (truncatedSeen.has(file)) continue;
      truncatedSeen.add(file);
      truncatedFiles.push(file);
    }
    // Every chunk carries the same plan-wide skip tally; keep the fullest one.
    if (outcome.skipCounts.length > skipCounts.length) skipCounts = outcome.skipCounts;
    droppedUngrounded += outcome.droppedUngrounded;
    spentUsd += outcome.chargeUsd;
    candidateCount = Math.max(candidateCount, outcome.candidateCount);
    deferredCount = Math.max(deferredCount, outcome.deferredCount);
    treeTruncated = treeTruncated || outcome.treeTruncated;
    skippedListTruncated = skippedListTruncated || outcome.skippedListTruncated;
    newCount += outcome.newCount;
    knownCount += outcome.knownCount;
    fixedCount += outcome.fixedCount;
  }

  findings.sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.location.localeCompare(b.location),
  );

  const chunksRun = outcomes.length;
  const riskLevel: "high" | "medium" | "low" = findings.some((item) => item.severity === "high")
    ? "high"
    : findings.some((item) => item.severity === "medium")
      ? "medium"
      : "low";

  const reasons: string[] = [];
  if (options.stoppedReason) reasons.push(options.stoppedReason);
  if (chunksRun < plannedChunks) {
    reasons.push(
      `only ${chunksRun} of ${plannedChunks} planned chunk${plannedChunks === 1 ? "" : "s"} ran — ${reviewedFiles.length} file${reviewedFiles.length === 1 ? "" : "s"} reviewed`,
    );
  }
  if (deferredCount > 0) {
    reasons.push(`${deferredCount} robot-code file${deferredCount === 1 ? " is" : "s are"} beyond this scan's chunk budget`);
  }
  if (treeTruncated) reasons.push("the repository tree listing was truncated by GitHub");
  if (truncatedFiles.length) {
    reasons.push(
      `${truncatedFiles.length} file${truncatedFiles.length === 1 ? " was" : "s were"} cut at the read cap — the model never saw the rest of ${truncatedFiles.length === 1 ? "it" : "them"}`,
    );
  }

  return {
    path: outcomes[0]?.path ?? "github-scan",
    riskLevel,
    findings,
    localRiskCount: findings.filter((item) => item.source === "local_rule").length,
    modelFindingCount: findings.filter((item) => item.source === "model").length,
    droppedUngrounded,
    reviewedFiles,
    skipped,
    skipCounts,
    candidateCount,
    deferredCount,
    treeTruncated,
    skippedListTruncated,
    truncated: truncatedFiles.length > 0,
    truncatedFiles,
    chunksRun,
    chunkCount: plannedChunks,
    spentUsd: Number(spentUsd.toFixed(2)),
    newCount,
    knownCount,
    fixedCount,
    fixedFindings,
    partial: reasons.length > 0,
    partialReason: reasons.length ? reasons.join("; ") : null,
  };
}

export type BugbotReviewLike = {
  path: string;
  riskLevel: "high" | "medium" | "low";
  findings: BugbotRunFinding[];
  localRiskCount: number;
  modelFindingCount: number;
  droppedUngrounded: number;
};

function fileOf(finding: BugbotRunFinding): string {
  return (finding.filePath ?? finding.location.replace(/:\d+$/, ""))
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .toLowerCase();
}

/**
 * Fold a single-file recheck back into the repo-wide table: the target file's
 * rows are replaced by what the recheck found, every other file's rows stay
 * exactly as they were — a one-file recheck never "clears" the rest of the repo.
 */
export function mergeBugbotFileRecheck(
  previous: BugbotReviewLike | null,
  recheck: { filePath: string; findings: BugbotRunFinding[]; droppedUngrounded: number },
): BugbotReviewLike {
  const target = recheck.filePath.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
  const kept = (previous?.findings ?? []).filter((finding) => fileOf(finding) !== target);
  const findings = [...kept, ...recheck.findings];
  findings.sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.location.localeCompare(b.location),
  );
  const riskLevel: "high" | "medium" | "low" = findings.some((item) => item.severity === "high")
    ? "high"
    : findings.some((item) => item.severity === "medium")
      ? "medium"
      : "low";
  return {
    path: previous?.path ?? recheck.filePath,
    riskLevel,
    findings,
    localRiskCount: findings.filter((item) => item.source === "local_rule").length,
    modelFindingCount: findings.filter((item) => item.source === "model").length,
    droppedUngrounded: (previous?.droppedUngrounded ?? 0) + recheck.droppedUngrounded,
  };
}

/**
 * The sentence shown under a finished scan. Deliberately states coverage as a
 * fraction of the repo's robot code — "no findings" only ever means "none in the
 * files we actually read".
 */
export function describeBugbotCoverage(result: BugbotRunResult): string {
  const reviewed = result.reviewedFiles.length;
  const candidates = Math.max(result.candidateCount, reviewed);
  const head = `Reviewed ${reviewed} of ${candidates} robot-code file${candidates === 1 ? "" : "s"}`;
  const skippedTotal = result.skipCounts.reduce((sum, item) => sum + item.count, 0);
  const skipTail = skippedTotal ? `, skipped ${skippedTotal} non-robot-code path${skippedTotal === 1 ? "" : "s"}` : "";
  return result.partial
    ? `${head}${skipTail}. PARTIAL coverage — ${result.partialReason}.`
    : `${head}${skipTail}. Full coverage of this scan plan.`;
}
