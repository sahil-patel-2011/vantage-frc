import type { buildDiffProposal, reviewFrcCode } from "@vantage/agent/coding-assistant";

export type Review = ReturnType<typeof reviewFrcCode>;
export type Proposal = ReturnType<typeof buildDiffProposal>;

export type BugbotMode = "subscription" | "ultra";
export type BugbotPhase = "scan" | "fix" | "recheck";

export type BugbotFinding = {
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

export type BugbotReview = {
  path: string;
  riskLevel: "high" | "medium" | "low";
  findings: BugbotFinding[];
  localRiskCount: number;
  modelFindingCount: number;
  droppedUngrounded: number;
};

export type BugbotHistoryRow = {
  id: string;
  path: string;
  riskLevel: string;
  localRiskCount: number;
  modelFindingCount: number;
  droppedUngrounded: number;
  provider: string | null;
  model: string | null;
  createdAt: string;
  tier?: string;
  phase?: string;
  githubRepo?: string | null;
  chargeUsd?: string;
  filesScanned?: number;
  newFindingCount?: number;
  knownFindingCount?: number;
  fixedFindingCount?: number;
  chunkIndex?: number;
  chunkCount?: number;
  partial?: boolean;
  partialReason?: string | null;
  githubSha?: string | null;
};

export type SkipRecord = { path: string; reason: string };
export type SkipCount = { reason: string; label: string; count: number };

export type ScanCoverage = {
  reviewedFiles: string[];
  skipped: SkipRecord[];
  skipCounts: SkipCount[];
  chunkIndex: number;
  chunkCount: number;
  candidateCount: number;
  deferredCount: number;
  treeTruncated: boolean;
  skippedListTruncated: boolean;
  partial?: boolean;
  partialReason?: string | null;
};

export type ScanPlan = {
  repo: string;
  ref: string;
  sha: string | null;
  chunkCount: number;
  chunkFiles: number;
  reviewed: Array<{ path: string; role: string; chunk: number }>;
  skipped: SkipRecord[];
  skipCounts: SkipCount[];
  skippedListTruncated: boolean;
  candidateCount: number;
  deferredCount: number;
  treeTruncated: boolean;
  cost: { perChunkUsd: number; totalUsd: number; chunkCount: number };
};

export type ScanProgress = {
  chunkIndex: number;
  chunkCount: number;
  spentUsd: number;
  running: boolean;
  partial: boolean;
  partialReason: string | null;
};

export type Dismissal = { fingerprint: string; reason: string; filePath: string | null; createdAt: string };

export type FixedFinding = { fingerprint: string; filePath: string; rule: string; finding: string };

/** One /api/code bugbot response, narrowed to what this client reads. */
export type BugbotResponse = {
  error?: string;
  code?: string;
  reason?: string;
  hardCutoff?: boolean;
  review?: BugbotReview;
  provider?: string;
  model?: string;
  mode?: BugbotMode;
  phase?: BugbotPhase;
  chargeUsd?: number;
  proposedDiff?: string | null;
  reviewId?: string | null;
  filesScanned?: number;
  fixDropped?: boolean;
  githubRepo?: string | null;
  githubRef?: string | null;
  githubSha?: string | null;
  branchMoved?: boolean;
  coverage?: ScanCoverage;
  delta?: { new: number; known: number; fixed: number; fixedFindings?: FixedFinding[] };
  dismissals?: Dismissal[];
  repoOverview?: string | null;
};

export const EMPTY_COVERAGE: ScanCoverage = {
  reviewedFiles: [],
  skipped: [],
  skipCounts: [],
  chunkIndex: 0,
  chunkCount: 1,
  candidateCount: 0,
  deferredCount: 0,
  treeTruncated: false,
  skippedListTruncated: false,
};

export type GitHubRepoOption = {
  fullName: string;
  defaultBranch: string;
  private: boolean;
};

export type BugbotMeta = {
  provider?: string;
  model?: string;
  mode?: BugbotMode;
  phase?: BugbotPhase;
  chargeUsd?: number;
  proposedDiff?: string | null;
  reviewId?: string | null;
  filesScanned?: number;
  elapsedMs?: number;
  githubRepo?: string | null;
  githubSha?: string | null;
  branchMoved?: boolean;
  repoOverview?: string | null;
};
