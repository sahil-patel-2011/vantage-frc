"use client";

import { useEffect, useMemo, useState } from "react";
import { BUGBOT_ULTRA_PRICES_USD, isBugbotScanPath } from "@vantage/agent/bugbot";
import { buildDiffProposal, reviewFrcCode } from "@vantage/agent/coding-assistant";
import { AiHubRelated } from "../../components/ai-hub-related";
import { BuildHubRelated } from "../../components/build-hub-related";
import { EmptyState } from "../../components/ui";
import { WhyPanel } from "../../components/why-panel";
import { CODE_RULE_LESSONS, narrateCodeFindings } from "../../lib/agent-narration/narration";
import { MeteredAiCutoffBanner } from "../../components/metered-ai-cutoff-banner";
import {
  resolveCutoffErrorCode,
  UsageCutoffBanner,
} from "../../components/usage-cutoff-banner";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import { githubConnectionHref } from "../../lib/github/github-related";
import {
  bugbotFindingFile,
  filterBugbotFindingsToFile,
  resolveBugbotTarget,
  type BugbotScanTarget,
} from "../../lib/bugbot/grounding";
import {
  describeBugbotCoverage,
  mergeBugbotFileRecheck,
  mergeBugbotScanRun,
  type BugbotChunkOutcome,
} from "../../lib/code/scan-run";
import {
  CODE_COACH_RELATED_INCLUDE,
  CODE_COACH_SAMPLE,
  codeCoachNextActions,
  codeCoachRelatedLinks,
  groundedCodeCoachProposal,
} from "../../lib/code/code-related";

/** Teach-not-do lessons live in the shared narration catalog so the WhyPanel and this list agree. */
const COACH_LESSONS = CODE_RULE_LESSONS;

type Review = ReturnType<typeof reviewFrcCode>;
type Proposal = ReturnType<typeof buildDiffProposal>;

type BugbotFinding = {
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

type BugbotReview = {
  path: string;
  riskLevel: "high" | "medium" | "low";
  findings: BugbotFinding[];
  localRiskCount: number;
  modelFindingCount: number;
  droppedUngrounded: number;
};

type BugbotHistoryRow = {
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

type SkipRecord = { path: string; reason: string };
type SkipCount = { reason: string; label: string; count: number };

type ScanCoverage = {
  reviewedFiles: string[];
  skipped: SkipRecord[];
  skipCounts: SkipCount[];
  chunkIndex: number;
  chunkCount: number;
  candidateCount: number;
  deferredCount: number;
  treeTruncated: boolean;
  skippedListTruncated: boolean;
  /** True when any reviewed file was cut at a read cap — the model never saw its tail. */
  truncated?: boolean;
  truncatedFiles?: string[];
  /** Set when the pass re-read exactly one file for a per-finding fix / recheck. */
  targetFile?: string | null;
  partial?: boolean;
  partialReason?: string | null;
};

/** Per-finding fix / recheck: the file that owns the finding, and which of its findings to address. */
type BugbotRunTarget = {
  filePath: string;
  /** The planned chunk that owns the file, when the scan plan lists it. */
  chunkIndex?: number;
  /** Restrict a fix to these findings; omitted = every finding in the file. */
  fingerprints?: string[];
};

type ScanPlan = {
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

type ScanProgress = {
  chunkIndex: number;
  chunkCount: number;
  spentUsd: number;
  running: boolean;
  partial: boolean;
  partialReason: string | null;
};

type Dismissal = { fingerprint: string; reason: string; filePath: string | null; createdAt: string };

type FixedFinding = { fingerprint: string; filePath: string; rule: string; finding: string };

/** One /api/code bugbot response, narrowed to what this client reads. */
type BugbotResponse = {
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
  listedChargeUsd?: number;
  /** The Ultra fix SKU was waived: no grounded diff came back, so nothing was charged. */
  chargeWaived?: boolean;
  contextAttached?: string[];
  proposedDiff?: string | null;
  filesScanned?: number;
  fixDropped?: boolean;
  githubRepo?: string | null;
  githubRef?: string | null;
  githubSha?: string | null;
  branchMoved?: boolean;
  coverage?: ScanCoverage;
  delta?: { new: number; known: number; fixed: number; fixedFindings?: FixedFinding[] };
  dismissals?: Dismissal[];
};

const EMPTY_COVERAGE: ScanCoverage = {
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

type GitHubRepoOption = {
  fullName: string;
  defaultBranch: string;
  private: boolean;
};

type BugbotMode = "subscription" | "ultra";
type BugbotPhase = "scan" | "fix" | "recheck";

export function CodeClient({
  orgId = "",
  related = "build",
  embedded = false,
}: {
  orgId?: string;
  /** Soft-UI related strip: Build hub vs AI hub embedding. */
  related?: "build" | "ai";
  embedded?: boolean;
}) {
  const [path, setPath] = useState("src/main/java/frc/robot/subsystems/DriveSubsystem.java");
  const [content, setContent] = useState(CODE_COACH_SAMPLE);
  const [review, setReview] = useState<Review | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [bugbot, setBugbot] = useState<BugbotReview | null>(null);
  const [bugbotMeta, setBugbotMeta] = useState<{
    provider?: string;
    model?: string;
    mode?: BugbotMode;
    phase?: BugbotPhase;
    chargeUsd?: number;
    proposedDiff?: string | null;
    filesScanned?: number;
    githubRepo?: string | null;
    githubSha?: string | null;
    branchMoved?: boolean;
  } | null>(null);
  /** What the last Bugbot scan actually ran against — a paid fix must target the same source. */
  const [lastScan, setLastScan] = useState<BugbotScanTarget | null>(null);
  const [history, setHistory] = useState<BugbotHistoryRow[]>([]);
  const [cutoffCode, setCutoffCode] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bugbotMode, setBugbotMode] = useState<BugbotMode>("subscription");
  const [githubConnected, setGithubConnected] = useState(false);
  const [githubLogin, setGithubLogin] = useState<string | null>(null);
  const [repos, setRepos] = useState<GitHubRepoOption[]>([]);
  const [selectedRepo, setSelectedRepo] = useState("");
  const [selectedRef, setSelectedRef] = useState("main");
  const [repoFiles, setRepoFiles] = useState<string[]>([]);
  const [treeTruncated, setTreeTruncated] = useState(false);
  const [githubEmptyReason, setGithubEmptyReason] = useState<string | null>(null);
  /** What a repo scan WOULD read, and what it costs — loaded before any model call. */
  const [scanPlan, setScanPlan] = useState<ScanPlan | null>(null);
  const [scanPlanReason, setScanPlanReason] = useState<string | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [coverage, setCoverage] = useState<ScanCoverage | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [delta, setDelta] = useState<{ new: number; known: number; fixed: number } | null>(null);
  const [fixedFindings, setFixedFindings] = useState<FixedFinding[]>([]);
  const [dismissals, setDismissals] = useState<Dismissal[]>([]);
  const [dismissTarget, setDismissTarget] = useState<BugbotFinding | null>(null);
  const [dismissReason, setDismissReason] = useState("");
  const [showCoverage, setShowCoverage] = useState(false);

  const hasSource = Boolean(content.trim());
  const showMeteredBanner = Boolean(orgId) && related === "ai";
  const relatedLinks = codeCoachRelatedLinks(orgId || null, { include: [...CODE_COACH_RELATED_INCLUDE] });
  const nextActions = codeCoachNextActions({
    orgId: orgId || null,
    hasSource,
    hasReview: Boolean(review),
  });
  const budgetsHref = orgId ? hubHref("/ai", "budgets", orgId) : "/ai?tab=budgets";
  const keysHref = orgId ? withOrgHref("/team/ai-keys", orgId) : "/team/ai-keys";

  const githubHref = orgId ? githubConnectionHref(orgId) : "/team/admin#github-connection";
  const robotFiles = useMemo(() => repoFiles.filter((file) => isBugbotScanPath(file)).slice(0, 80), [repoFiles]);

  /**
   * Show-your-work narration. Derived from findings that actually matched evidence in the source —
   * an empty review narrates nothing rather than explaining a risk that was never found.
   */
  const coachNarrations = useMemo(
    () =>
      narrateCodeFindings(
        (review?.risks ?? []).map((risk) => ({
          severity: risk.severity,
          pattern: risk.pattern,
          message: risk.message,
          evidence: risk.evidence,
          location: path,
        })),
      ),
    [review, path],
  );
  const bugbotNarrations = useMemo(() => narrateCodeFindings(bugbot?.findings ?? []), [bugbot]);

  useEffect(() => {
    if (!orgId) return;
    void fetch(`/api/code?orgId=${encodeURIComponent(orgId)}`)
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as {
          reviews?: BugbotHistoryRow[];
          dismissals?: Dismissal[];
          github?: {
            connected?: boolean;
            login?: string | null;
            defaultRepoFullName?: string | null;
            defaultRepoDefaultBranch?: string | null;
          };
        };
        setHistory(data.reviews ?? []);
        setDismissals(data.dismissals ?? []);
        if (data.github?.connected) {
          setGithubConnected(true);
          setGithubLogin(data.github.login ?? null);
          if (data.github.defaultRepoFullName) {
            setSelectedRepo((prev) => prev || data.github!.defaultRepoFullName!);
            setSelectedRef(data.github.defaultRepoDefaultBranch || "main");
          }
        } else {
          setGithubConnected(false);
        }
      })
      .catch(() => undefined);
  }, [orgId]);

  useEffect(() => {
    if (!orgId || !githubConnected) return;
    void fetch(`/api/github/repos?orgId=${encodeURIComponent(orgId)}`)
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as {
          empty?: boolean;
          emptyReason?: string | null;
          repos?: GitHubRepoOption[];
          defaultRepoFullName?: string | null;
        };
        setRepos(data.repos ?? []);
        setGithubEmptyReason(data.empty ? data.emptyReason ?? "No repositories visible." : null);
        if (data.defaultRepoFullName) {
          setSelectedRepo((prev) => prev || data.defaultRepoFullName!);
        }
      })
      .catch(() => undefined);
  }, [orgId, githubConnected]);

  useEffect(() => {
    if (!orgId || !githubConnected || !selectedRepo) {
      setRepoFiles([]);
      return;
    }
    const params = new URLSearchParams({
      orgId,
      repo: selectedRepo,
      ref: selectedRef || "main",
      tree: "1",
    });
    void fetch(`/api/github/contents?${params}`)
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as {
          empty?: boolean;
          emptyReason?: string | null;
          tree?: { entries?: Array<{ path: string; type: string }>; truncated?: boolean } | null;
        };
        const entries = data.tree?.entries ?? [];
        setRepoFiles(entries.filter((entry) => entry.type === "blob").map((entry) => entry.path));
        setTreeTruncated(Boolean(data.tree?.truncated));
        if (data.empty && data.emptyReason) setGithubEmptyReason(data.emptyReason);
      })
      .catch(() => undefined);
  }, [orgId, githubConnected, selectedRepo, selectedRef]);

  /**
   * Free scan plan: what the repo scan will read, what it skips and why, how many
   * metered chunks it takes, and therefore its cost — all before the button.
   */
  useEffect(() => {
    if (!orgId || !githubConnected || !selectedRepo) {
      setScanPlan(null);
      setScanPlanReason(null);
      return;
    }
    let cancelled = false;
    setPlanLoading(true);
    const params = new URLSearchParams({
      orgId,
      plan: "1",
      repo: selectedRepo,
      ref: selectedRef || "main",
      tier: bugbotMode,
    });
    void fetch(`/api/code?${params}`)
      .then(async (response) => {
        const data = (await response.json()) as
          | ({ empty?: false } & ScanPlan)
          | { empty: true; emptyReason: string }
          | { error?: string };
        if (cancelled) return;
        if (!response.ok || "error" in data) {
          setScanPlan(null);
          setScanPlanReason(("error" in data && data.error) || "Could not plan a scan for this repo.");
          return;
        }
        if ("empty" in data && data.empty) {
          setScanPlan(null);
          setScanPlanReason(data.emptyReason);
          return;
        }
        setScanPlan(data as ScanPlan);
        setScanPlanReason(null);
      })
      .catch(() => {
        if (!cancelled) setScanPlanReason("Could not reach GitHub to plan this scan.");
      })
      .finally(() => {
        if (!cancelled) setPlanLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, githubConnected, selectedRepo, selectedRef, bugbotMode]);

  async function loadGithubFile(filePath: string) {
    if (!orgId || !selectedRepo || !filePath) return;
    setBusy(true);
    setMessage(null);
    try {
      const params = new URLSearchParams({
        orgId,
        repo: selectedRepo,
        ref: selectedRef || "main",
        path: filePath,
      });
      const response = await fetch(`/api/github/contents?${params}`);
      const data = (await response.json()) as {
        error?: string;
        empty?: boolean;
        emptyReason?: string | null;
        file?: { path: string; content: string } | null;
      };
      if (!response.ok || data.empty || !data.file?.content) {
        setMessage(data.emptyReason || data.error || "Could not load that GitHub file.");
        return;
      }
      setPath(data.file.path);
      setContent(data.file.content);
      setReview(null);
      setProposal(null);
      setBugbot(null);
      setLastScan(null);
      setMessage(`Loaded ${selectedRepo}:${data.file.path} (read-only).`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load GitHub file");
    } finally {
      setBusy(false);
    }
  }

  /** Pull the server's own view of history, open findings, and dismissals. */
  async function refreshBugbotState() {
    if (!orgId) return;
    const params = new URLSearchParams({ orgId });
    if (selectedRepo) params.set("repo", selectedRepo);
    try {
      const response = await fetch(`/api/code?${params}`);
      if (!response.ok) return;
      const data = (await response.json()) as { reviews?: BugbotHistoryRow[]; dismissals?: Dismissal[] };
      setHistory(data.reviews ?? []);
      setDismissals(data.dismissals ?? []);
    } catch {
      // History is a convenience; a failed refresh must never mask the scan result.
    }
  }

  /** "We looked at this and it is deliberate" — persists per fingerprint across commits. */
  async function submitDismissal() {
    const target = dismissTarget;
    const reason = dismissReason.trim();
    if (!target?.fingerprint || !orgId) return;
    if (reason.length < 3) {
      setMessage("Give a reason (at least 3 characters) so the next scan explains itself.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "dismiss",
          orgId,
          path,
          githubRepo: lastScan?.repo ?? selectedRepo ?? undefined,
          fingerprint: target.fingerprint,
          reason,
          filePath: target.filePath ?? target.location.split(":")[0],
          rule: target.pattern ?? target.source,
        }),
      });
      const data = (await response.json()) as { dismissals?: Dismissal[]; error?: string };
      if (!response.ok) {
        setMessage(typeof data.error === "string" ? data.error : "Could not dismiss that finding.");
        return;
      }
      setDismissals(data.dismissals ?? []);
      setBugbot((prev) =>
        prev
          ? { ...prev, findings: prev.findings.filter((item) => item.fingerprint !== target.fingerprint) }
          : prev,
      );
      setDismissTarget(null);
      setDismissReason("");
      setMessage("Dismissed. Future scans of this repo will stay quiet about that finding until you restore it.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not dismiss that finding.");
    } finally {
      setBusy(false);
    }
  }

  async function restoreDismissal(fingerprint: string) {
    if (!orgId) return;
    setBusy(true);
    try {
      const response = await fetch("/api/code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "restore",
          orgId,
          path,
          githubRepo: lastScan?.repo ?? selectedRepo ?? undefined,
          fingerprint,
        }),
      });
      const data = (await response.json()) as { dismissals?: Dismissal[]; error?: string };
      if (!response.ok) {
        setMessage(typeof data.error === "string" ? data.error : "Could not restore that finding.");
        return;
      }
      setDismissals(data.dismissals ?? []);
      setMessage("Restored — the next scan will report that finding again if it is still in the source.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not restore that finding.");
    } finally {
      setBusy(false);
    }
  }

  async function runBugbot(options?: {
    mode?: BugbotMode;
    phase?: BugbotPhase;
    scanRepo?: boolean;
    /** Per-finding fix / recheck: re-read the file that owns the finding, not chunk 0. */
    target?: BugbotRunTarget;
  }) {
    const mode = options?.mode ?? bugbotMode;
    const phase = options?.phase ?? "scan";
    const fileTarget = phase === "scan" ? null : (options?.target ?? null);
    // Fix/recheck after a repo scan must target the scanned repo (fix pinned to
    // the scanned commit sha) — never the editor buffer, which may hold
    // unrelated source. Editor-paste scans keep buffer behaviour.
    const target = resolveBugbotTarget({
      phase,
      scanRepoRequested: Boolean(options?.scanRepo),
      lastScan,
    });
    const useRepo = target.useRepo;
    const targetRepo = (useRepo ? target.repo || selectedRepo : selectedRepo) || undefined;
    const targetRef = (useRepo ? target.ref || selectedRef : selectedRef) || undefined;
    if (!useRepo && !content.trim()) {
      setMessage("Paste robot source, load a GitHub file, or scan the connected repo.");
      return;
    }
    if (!orgId) {
      setMessage("Choose a workspace before running Bugbot.");
      return;
    }
    if (useRepo && !githubConnected) {
      setMessage("Connect GitHub in Team admin before scanning a repo.");
      return;
    }
    // A repo pass is one metered call PER PLANNED CHUNK. Running them here (rather
    // than reading only chunk 0) is the difference between "we reviewed your repo"
    // and "we reviewed the first eight files and did not mention it". A recheck
    // chunks too: a recheck that only re-read chunk 0 would report the rest of the
    // repo as unchanged without having looked at it.
    //
    // A per-finding fix / recheck is ONE call against the file that owns the
    // finding: the server re-reads that file (pinned to the scanned sha for a
    // fix) and only that file's findings travel with the request. Chunk 0 is
    // never a default target.
    const isRepoScan = useRepo && (phase === "scan" || phase === "recheck") && !fileTarget;
    const plannedChunks = isRepoScan ? Math.max(1, scanPlan?.chunkCount ?? 1) : 1;
    const allFindings = bugbot?.findings ?? [];
    const scopedFindings = fileTarget ? filterBugbotFindingsToFile(allFindings, fileTarget.filePath) : allFindings;
    const pickedFindings = fileTarget?.fingerprints
      ? scopedFindings.filter((item) => item.fingerprint && fileTarget.fingerprints!.includes(item.fingerprint))
      : scopedFindings;
    const findingsPayload = pickedFindings.length ? pickedFindings : scopedFindings;

    setBusy(true);
    setCutoffCode(null);
    setMessage(null);
    if (isRepoScan) {
      setCoverage(null);
      setDelta(null);
      setFixedFindings([]);
      setProgress({
        chunkIndex: 0,
        chunkCount: plannedChunks,
        spentUsd: 0,
        running: true,
        partial: false,
        partialReason: null,
      });
    }

    const outcomes: BugbotChunkOutcome[] = [];
    let stoppedReason: string | null = null;

    function postChunk(chunkIndex: number, spentUsd: number) {
      return fetch("/api/code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "bugbot",
          path,
          content: useRepo ? undefined : content,
          orgId,
          mode,
          phase,
          scanRepo: useRepo,
          githubRepo: targetRepo,
          githubRef: targetRef,
          githubSha: target.pinnedSha ?? undefined,
          githubPath: !useRepo && path && githubConnected ? path : undefined,
          findings: findingsPayload,
          targetFilePath: fileTarget?.filePath,
          targetChunkIndex: fileTarget?.chunkIndex,
          chunkIndex,
          spentUsd,
          parentReviewId: history[0]?.id || undefined,
        }),
      });
    }

    function applyMeta(data: BugbotResponse) {
      setBugbotMeta({
        provider: data.provider,
        model: data.model,
        mode: data.mode ?? mode,
        phase: data.phase ?? phase,
        chargeUsd: data.chargeUsd,
        proposedDiff: data.proposedDiff,
        filesScanned: data.filesScanned,
        githubRepo: data.githubRepo ?? (useRepo ? targetRepo ?? null : null),
        githubSha: data.githubSha ?? null,
        branchMoved: Boolean(data.branchMoved),
      });
      setLastScan(
        useRepo
          ? {
              scanRepo: true,
              repo: data.githubRepo ?? targetRepo ?? null,
              ref: data.githubRef ?? targetRef ?? null,
              sha: data.githubSha ?? null,
            }
          : { scanRepo: false, repo: null, ref: null, sha: null },
      );
      if (data.dismissals) setDismissals(data.dismissals);
    }

    function billedNote(chargeUsd: number | undefined, modeUsed: BugbotMode | undefined): string {
      return modeUsed === "ultra" && chargeUsd
        ? ` Charged $${Number(chargeUsd).toFixed(2)} Bugbot Ultra.`
        : " Uses your subscription / BYO key.";
    }

    try {
      for (let chunkIndex = 0; chunkIndex < plannedChunks; chunkIndex += 1) {
        const spentSoFar = outcomes.reduce((sum, item) => sum + item.chargeUsd, 0);
        const response = await postChunk(chunkIndex, spentSoFar);
        const data = (await response.json()) as BugbotResponse;

        if (!response.ok) {
          const cutoff = resolveCutoffErrorCode(response.status, {
            code: data.code,
            reason: data.reason,
            error: data.error,
            hardCutoff: data.hardCutoff,
          });
          if (cutoff) setCutoffCode(cutoff);
          const reason = typeof data.error === "string" ? data.error : "AI Bugbot failed.";
          // Nothing succeeded: this is a plain failure, not a partial scan.
          if (!outcomes.length) {
            setMessage(reason);
            return;
          }
          // Some chunks were paid for and did produce findings — keep them and say
          // plainly that coverage stopped here rather than discarding the spend.
          stoppedReason = `stopped after chunk ${outcomes.length} of ${plannedChunks}: ${reason}`;
          break;
        }
        if (!data.review) break;

        applyMeta(data);

        if (!isRepoScan) {
          // Single-call phases: file scan, fix, one-file recheck, buffer recheck.
          const review = data.review;
          const billed = billedNote(data.chargeUsd, data.mode);
          const shaShort = data.githubSha ? data.githubSha.slice(0, 7) : null;
          const grounded =
            useRepo && shaShort ? ` Source: ${data.githubRepo ?? targetRepo ?? "repo"}@${shaShort}.` : "";
          const moved = data.branchMoved ? " Branch moved since that scan — rescan recommended." : "";
          const targetLabel = fileTarget ? ` ${fileTarget.filePath}` : " this source";
          setProgress(null);
          if (phase === "fix") {
            // A fix never replaces the findings table — the table is what the
            // scan found; the diff lives in bugbotMeta.proposedDiff.
            const waived = data.chargeWaived ? " Not charged — no grounded diff came back." : "";
            setMessage(
              data.proposedDiff
                ? `Grounded fix for${targetLabel} ready — human approval required. Never pushed to GitHub.${grounded}${moved}${billed}`
                : `No grounded diff for${targetLabel} (unquoted removals dropped). Nothing was pushed.${grounded}${moved}${waived || billed}`,
            );
          } else if (fileTarget) {
            // A one-file recheck replaces only that file's rows; every other
            // file's findings stay exactly as the scan left them.
            setBugbot((prev) =>
              mergeBugbotFileRecheck(prev, {
                filePath: fileTarget.filePath,
                findings: review.findings,
                droppedUngrounded: review.droppedUngrounded,
              }),
            );
            setDelta(data.delta ? { new: data.delta.new, known: data.delta.known, fixed: data.delta.fixed } : null);
            setFixedFindings(data.delta?.fixedFindings ?? []);
            setMessage(
              `Bugbot recheck of ${fileTarget.filePath}: ${review.findings.length} grounded finding${review.findings.length === 1 ? "" : "s"} still present · ${data.delta?.fixed ?? 0} fixed.${grounded}${moved}${billed} Other files were not re-read.`,
            );
          } else {
            setBugbot(review);
            setCoverage(data.coverage ?? null);
            setDelta(data.delta ? { new: data.delta.new, known: data.delta.known, fixed: data.delta.fixed } : null);
            setFixedFindings(data.delta?.fixedFindings ?? []);
            const cut = data.coverage?.truncated
              ? " Source was cut at the read cap — findings past the cut are not covered."
              : "";
            setMessage(
              review.findings.length
                ? `Bugbot ${phase}: ${review.findings.length} grounded finding${review.findings.length === 1 ? "" : "s"} (${review.localRiskCount} local · ${review.modelFindingCount} model). Ungrounded claims dropped: ${review.droppedUngrounded}.${grounded}${moved}${cut}${billed} Never deploys.`
                : `Bugbot ${phase} complete — no grounded findings.${grounded}${moved}${cut}${billed} Empty is not certification.`,
            );
          }
          await refreshBugbotState();
          return;
        }

        const cover = data.coverage;
        outcomes.push({
          chunkIndex,
          path: data.review.path,
          findings: data.review.findings,
          droppedUngrounded: data.review.droppedUngrounded,
          chargeUsd: Number(data.chargeUsd ?? 0),
          reviewedFiles: cover?.reviewedFiles ?? [],
          skipped: cover?.skipped ?? [],
          skipCounts: cover?.skipCounts ?? [],
          candidateCount: cover?.candidateCount ?? 0,
          deferredCount: cover?.deferredCount ?? 0,
          treeTruncated: Boolean(cover?.treeTruncated),
          skippedListTruncated: Boolean(cover?.skippedListTruncated),
          truncatedFiles: cover?.truncatedFiles ?? [],
          newCount: data.delta?.new ?? 0,
          knownCount: data.delta?.known ?? 0,
          fixedCount: data.delta?.fixed ?? 0,
          fixedFindings: data.delta?.fixedFindings ?? [],
        });

        const run = mergeBugbotScanRun(outcomes, { plannedChunks, stoppedReason: null });
        // Stream the partial result so a long scan shows its work as it goes.
        setBugbot({
          path: run.path,
          riskLevel: run.riskLevel,
          findings: run.findings,
          localRiskCount: run.localRiskCount,
          modelFindingCount: run.modelFindingCount,
          droppedUngrounded: run.droppedUngrounded,
        });
        setProgress({
          chunkIndex: chunkIndex + 1,
          chunkCount: plannedChunks,
          spentUsd: run.spentUsd,
          running: chunkIndex + 1 < plannedChunks,
          partial: false,
          partialReason: null,
        });
      }

      if (isRepoScan) {
        if (!outcomes.length) {
          setProgress(null);
          if (!stoppedReason) setMessage("No chunk of this repo scan returned a result.");
          return;
        }
        const run = mergeBugbotScanRun(outcomes, { plannedChunks, stoppedReason });
        setBugbot({
          path: run.path,
          riskLevel: run.riskLevel,
          findings: run.findings,
          localRiskCount: run.localRiskCount,
          modelFindingCount: run.modelFindingCount,
          droppedUngrounded: run.droppedUngrounded,
        });
        setCoverage({
          ...EMPTY_COVERAGE,
          reviewedFiles: run.reviewedFiles,
          skipped: run.skipped,
          skipCounts: run.skipCounts,
          chunkIndex: run.chunksRun - 1,
          chunkCount: run.chunkCount,
          candidateCount: run.candidateCount,
          deferredCount: run.deferredCount,
          treeTruncated: run.treeTruncated,
          skippedListTruncated: run.skippedListTruncated,
          truncated: run.truncated,
          truncatedFiles: run.truncatedFiles,
          partial: run.partial,
          partialReason: run.partialReason,
        });
        setDelta({ new: run.newCount, known: run.knownCount, fixed: run.fixedCount });
        setFixedFindings(run.fixedFindings);
        setProgress({
          chunkIndex: run.chunksRun,
          chunkCount: run.chunkCount,
          spentUsd: run.spentUsd,
          running: false,
          partial: run.partial,
          partialReason: run.partialReason,
        });
        const billed =
          mode === "ultra"
            ? ` Charged $${run.spentUsd.toFixed(2)} Bugbot Ultra across ${run.chunksRun} chunk${run.chunksRun === 1 ? "" : "s"}.`
            : " Uses your subscription / BYO key.";
        const found = run.findings.length
          ? `${run.findings.length} grounded finding${run.findings.length === 1 ? "" : "s"} (${run.newCount} new · ${run.knownCount} known · ${run.fixedCount} fixed)`
          : "no grounded findings";
        setMessage(`Bugbot repo ${phase}: ${found}. ${describeBugbotCoverage(run)}${billed} Never deploys.`);
        await refreshBugbotState();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "AI Bugbot failed");
      setProgress((prev) => (prev ? { ...prev, running: false } : prev));
    } finally {
      setBusy(false);
    }
  }

  function runReview() {
    if (!content.trim()) {
      setReview(null);
      setProposal(null);
      setMessage("Paste robot source (or load the sample) before running a review.");
      return;
    }
    setBusy(true);
    setMessage(null);
    setProposal(null);
    try {
      const next = reviewFrcCode({ path, content });
      setReview(next);
      setMessage(
        next.risks.length
          ? `Flagged ${next.risks.length} matched pattern${next.risks.length === 1 ? "" : "s"} — teaching notes only for rules that hit. No invented findings.`
          : "Review complete — no local risk patterns matched in this source.",
      );
      void fetch("/api/code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "review", path, content, orgId: orgId || undefined }),
      }).catch(() => undefined);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Review failed");
    } finally {
      setBusy(false);
    }
  }

  function runPropose() {
    if (!content.trim()) {
      setMessage("Paste robot source before building a proposal.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const nextReview = reviewFrcCode({ path, content });
      setReview(nextReview);
      const grounded = groundedCodeCoachProposal({ path, content });
      if (!grounded) {
        setProposal(null);
        setMessage(
          nextReview.risks.length
            ? `Matched ${nextReview.risks.length} pattern${nextReview.risks.length === 1 ? "" : "s"} — coach will not invent a unified diff for this source. Mentors write the change after reading the teaching notes.`
            : "No matched patterns and no grounded sample diff — nothing to propose.",
        );
        return;
      }
      const nextProposal = buildDiffProposal({
        path,
        summary: grounded.summary,
        unifiedDiff: grounded.unifiedDiff,
        review: nextReview,
      });
      setProposal(nextProposal);
      setMessage("Proposal created from the teaching sample — human approval required. Vantage does not deploy to a robot.");
      void fetch("/api/code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "propose",
          path,
          content,
          summary: nextProposal.title,
          unifiedDiff: grounded.unifiedDiff,
          orgId: orgId || undefined,
        }),
      }).catch(() => undefined);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Proposal failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={`module-page cdc-page${embedded ? " is-embedded" : ""}`}>
      {!embedded ? (
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">{related === "ai" ? "AI / Code assist" : "Build / Code Coach"}</span>
          <h1>FRC Code Coach</h1>
          <p>
            Flag risky robot-code patterns, explain why they fail under match pressure, then suggest a safer habit.
            Pattern review runs locally — findings only come from matched rules, never invented AI output. Proposed
            changes stay human-approved unified diffs. It never deploys to a robot.
          </p>
        </div>
        <div className="cdc-header-actions">
          <span className="app-badge good">Local · proposal-only</span>
          {orgId ? (
            <a className="app-button secondary" href={withOrgHref("/editor/pair", orgId)}>
              Pair VS Code
            </a>
          ) : null}
        </div>
      </header>
      ) : null}

      {!embedded ? (
        related === "ai" ? (
          orgId ? <AiHubRelated orgId={orgId} active="code" /> : null
        ) : (
          <BuildHubRelated orgId={orgId} active="code" />
        )
      ) : null}

      {!orgId ? (
        <EmptyState
          soft
          badge="Setup required"
          badgeTone="setup"
          title="Choose a team to coach code"
          description="Local pattern review works without a model key. Pairing VS Code, GitHub context, CAD, and AI chat need a workspace."
          className="product-hub-setup"
        >
          <a className="app-button" href="/workspace">
            Choose workspace
          </a>
        </EmptyState>
      ) : (
        <nav className="cdc-gov" aria-label="CAD, GitHub, and AI chat">
          {relatedLinks.map((link) => (
            <a key={link.id} href={link.href}>
              {link.label}
            </a>
          ))}
          <a href={budgetsHref}>Budgets</a>
          <a href={withOrgHref("/team/usage", orgId)}>AI usage</a>
        </nav>
      )}

      <section className="cdc-billing" aria-label="Local versus metered">
        <article className="cdc-billing-local">
          <span className="app-badge good">Local · free</span>
          <h2>Code Coach pattern review</h2>
          <p>
            Risk rules run in the browser against pasted or loaded source. No provider key, no plan credits, and no
            findings unless a rule matches evidence in your file.
          </p>
        </article>
        <article className="cdc-billing-metered">
          <span className="app-badge">Subscription</span>
          <h2>Bugbot on your plan</h2>
          <p>
            Scan connected GitHub robot-code (or a pasted file) on your workspace allowance / BYO key. Findings must
            quote the source. Distinct from CAD briefs and chat.
          </p>
          <div className="cdc-billing-actions">
            <a className="app-button secondary" href="#bugbot">
              AI Bugbot
            </a>
            <a className="app-button secondary" href={keysHref}>
              AI keys
            </a>
          </div>
        </article>
        <article className="cdc-billing-ultra">
          <span className="app-badge">Bugbot Ultra</span>
          <h2>Hosted API · published prices</h2>
          <p>
            Straight hosted pass that does not use your BYO key: ${BUGBOT_ULTRA_PRICES_USD.scan.toFixed(2)} to scan, $
            {BUGBOT_ULTRA_PRICES_USD.fix.toFixed(2)} to propose a fix, ${BUGBOT_ULTRA_PRICES_USD.recheck.toFixed(2)} to
            recheck. Fixes stay diffs — never pushed to GitHub.
          </p>
          <div className="cdc-billing-actions">
            <a className="app-button secondary" href="#bugbot">
              Ultra prices
            </a>
            <a className="app-button secondary" href={githubHref}>
              Connect GitHub
            </a>
          </div>
        </article>
      </section>

      {showMeteredBanner ? (
        <MeteredAiCutoffBanner orgId={orgId} className="cdc-cutoff" />
      ) : null}
      {cutoffCode ? <UsageCutoffBanner orgId={orgId} errorCode={cutoffCode} className="cdc-cutoff" /> : null}

      <section className="cdc-next-actions app-card soft-panel" aria-label="Next actions">
        <header>
          <h2>Next actions</h2>
          <p className="app-muted">Setup and cross-links — never placeholder review findings.</p>
        </header>
        <ol>
          {nextActions.map((action) => (
            <li key={action.id} className={action.primary ? "primary" : undefined}>
              <div>
                <strong>{action.label}</strong>
                <span>{action.detail}</span>
              </div>
              <a className="app-button secondary" href={action.href} aria-label={`Open ${action.label}`}>Open</a>
            </li>
          ))}
        </ol>
      </section>

      <section className="cdc-flow" aria-label="Teach, don't just do">
        <article>
          <b>01 · Flag</b>
          <h2>Catch the risky line</h2>
          <p>
            Blocking loops, duplicate CAN IDs, missing current limits, motor safety off, empty catch blocks,
            hard-coded ports and alliance colour, deprecated WPILib APIs — every hit, with its line.
          </p>
        </article>
        <article>
          <b>02 · Explain</b>
          <h2>Why it fails on match day</h2>
          <p>Each finding carries a teaching note so students learn the failure mode — not just a red underline.</p>
        </article>
        <article>
          <b>03 · Correct pattern</b>
          <h2>Suggest a safer habit</h2>
          <p>WPILib-aligned alternatives stay reviewable. Mentors approve diffs; simulation stays with the team.</p>
        </article>
      </section>

      {message ? (
        <p role="status" className="telemetry-status">
          {message}
        </p>
      ) : null}

      <section className="cdc-workbench">
        <div className="cdc-source" id="cdc-source">
          <article className="cdc-panel">
            <header>
              <div>
                <span className="app-badge good">Local review</span>
                <h2>Paste / edit source</h2>
              </div>
            </header>
            {!hasSource ? (
              <EmptyState
                soft
                badge="Empty"
                badgeTone="setup"
                title="No source yet"
                description="Paste subsystem code, or load the teaching sample. Findings stay empty until a review matches real rules."
              >
                <button
                  type="button"
                  className="app-button"
                  onClick={() => {
                    setContent(CODE_COACH_SAMPLE);
                    setReview(null);
                    setProposal(null);
                    setMessage(null);
                  }}
                >
                  Load teaching sample
                </button>
              </EmptyState>
            ) : null}
            <label>
              Path
              <input value={path} onChange={(event) => setPath(event.target.value)} />
            </label>
            <label>
              Source
              <textarea
                value={content}
                onChange={(event) => {
                  setContent(event.target.value);
                  setReview(null);
                  setProposal(null);
                }}
                rows={14}
                aria-label="Source code"
              />
            </label>
            <footer className="cdc-actions">
              <button type="button" className="primary-action" disabled={busy || !hasSource} onClick={runReview}>
                Run risk review
              </button>
              <button
                type="button"
                className="app-button secondary"
                disabled={busy || !hasSource}
                onClick={runPropose}
              >
                Build proposal (diff)
              </button>
              <button
                type="button"
                className="app-button secondary"
                disabled={busy || !hasSource || !orgId}
                onClick={() => void runBugbot()}
              >
                Run AI Bugbot
              </button>
              <button
                type="button"
                className="app-button secondary"
                disabled={busy}
                onClick={() => {
                  setContent(CODE_COACH_SAMPLE);
                  setReview(null);
                  setProposal(null);
                  setMessage(null);
                }}
              >
                Reset sample
              </button>
            </footer>
          </article>
        </div>

        <div className="cdc-side">
          <article className="cdc-panel">
            <header>
              <div>
                <span className={`app-badge ${review?.riskLevel === "high" ? "danger" : review ? "" : "setup"}`}>
                  {review?.riskLevel ?? "idle"} risk
                </span>
                <h2>Coach findings</h2>
              </div>
              <strong>{review?.risks.length ?? 0}</strong>
            </header>

            {review ? (
              review.risks.length === 0 ? (
                <EmptyState
                  soft
                  badge="Clear"
                  badgeTone="good"
                  title="No risk patterns matched"
                  description="This pass found nothing in the local coach rules. Still run simulation tests before enabling on a robot — empty is not certification."
                />
              ) : (
                <ul className="cdc-findings">
                  {review.risks.map((risk, index) => {
                    // Every rule ships its own lesson; the narration catalog wins when it has one.
                    const lesson = COACH_LESSONS[risk.pattern] ?? risk.lesson;
                    return (
                      <li className="cdc-finding" key={`${risk.pattern}:${risk.line}:${index}`}>
                        <div className="cdc-finding-head">
                          <span className={`cdc-severity ${risk.severity}`}>{risk.severity}</span>
                          <b>{risk.pattern.replaceAll("-", " ")}</b>
                        </div>
                        <p style={{ margin: 0, fontSize: 13 }}>{risk.message}</p>
                        {lesson ? (
                          <div className="cdc-lesson" aria-label="Teach, don't just do">
                            <span>Flag</span>
                            <p>{lesson.flag}</p>
                            <span>Explain</span>
                            <p>{lesson.explain}</p>
                            <span>Correct pattern</span>
                            <p>{lesson.habit}</p>
                          </div>
                        ) : null}
                        <code>{risk.evidence}</code>
                      </li>
                    );
                  })}
                </ul>
              )
            ) : (
              <EmptyState
                soft
                badge="Idle"
                badgeTone="setup"
                title="No review yet"
                description="Paste robot code or use the sample, then run a review. Findings appear only when a local rule matches — never invented AI diagnoses. Vantage never deploys to a robot."
              />
            )}

            {coachNarrations.length ? (
              <WhyPanel
                narrations={coachNarrations}
                orgId={orgId || undefined}
                title="Why each line was flagged"
                subtitle={`${coachNarrations.length} matched rule${coachNarrations.length === 1 ? "" : "s"} · reason and habit come from the rule that fired`}
              />
            ) : null}
          </article>

          <article className="cdc-panel">
            <header>
              <div>
                <span className="app-badge good">Policy</span>
                <h2>Required checks</h2>
              </div>
            </header>
            <ol className="cdc-checks">
              {(review?.requiredChecks ?? [
                "Run unit/simulation tests before deploying to a robot.",
                "Review CAN IDs, current limits, inversion, neutral mode, and mechanism soft limits.",
                "Test enable/disable transitions with the robot safely supported.",
              ]).map((check, index) => (
                <li key={check}>
                  <b>{index + 1}</b>
                  <span>{check}</span>
                </li>
              ))}
            </ol>
            <div className="cdc-proposal">
              <span>Output state</span>
              <strong>
                {proposal
                  ? `${proposal.executionState} · human approval required`
                  : "Proposal only · human approval required"}
              </strong>
              <p className="app-muted" style={{ margin: 0, fontSize: 12 }}>
                No autonomous robot deploy. Mentors or students approve every grounded diff — coach never invents
                fixes for unmatched source.
              </p>
              {proposal ? <pre aria-label="Unified diff proposal">{proposal.unifiedDiff}</pre> : null}
            </div>
          </article>
        </div>
      </section>

      <section className="cdc-workbench" id="bugbot" aria-label="AI Bugbot">
        <article className="cdc-panel">
          <header>
            <div>
              <span className="app-badge">{bugbotMode === "ultra" ? "Bugbot Ultra" : "Subscription"}</span>
              <h2>AI Bugbot</h2>
              <p className="app-muted" style={{ margin: "4px 0 0" }}>
                Connect a GitHub repo, scan robot-code, then optionally propose a human-approved diff and recheck.
                Findings must quote the source. Never deploys, never pushes.
                {bugbotMeta?.model ? ` · ${bugbotMeta.provider}/${bugbotMeta.model}` : ""}
              </p>
            </div>
          </header>

          <div className="cdc-bugbot-modes" role="group" aria-label="Bugbot billing mode">
            <button
              type="button"
              className={bugbotMode === "subscription" ? "is-active" : undefined}
              disabled={busy}
              onClick={() => setBugbotMode("subscription")}
            >
              <strong>On your subscription</strong>
              <span>Plan allowance or BYO key · feature=coding</span>
            </button>
            <button
              type="button"
              className={bugbotMode === "ultra" ? "is-active" : undefined}
              disabled={busy}
              onClick={() => setBugbotMode("ultra")}
            >
              <strong>Bugbot Ultra</strong>
              <span>
                ${BUGBOT_ULTRA_PRICES_USD.scan.toFixed(2)} scan · ${BUGBOT_ULTRA_PRICES_USD.fix.toFixed(2)} fix · $
                {BUGBOT_ULTRA_PRICES_USD.recheck.toFixed(2)} recheck
              </span>
            </button>
          </div>

          {!orgId ? (
            <EmptyState
              soft
              badge="Setup required"
              badgeTone="setup"
              title="Choose a workspace for Bugbot"
              description="Local pattern review is free. GitHub scans and both Bugbot modes need a team."
            >
              <a className="app-button" href="/workspace">
                Choose workspace
              </a>
            </EmptyState>
          ) : !githubConnected ? (
            <EmptyState
              soft
              badge="GitHub"
              badgeTone="setup"
              title="Connect a GitHub repo to scan"
              description="Owners and admins link a PAT or OAuth app under Team admin. You can still paste a file below without GitHub."
            >
              <a className="app-button" href={githubHref}>
                Connect GitHub
              </a>
            </EmptyState>
          ) : (
            <div className="cdc-github-scan">
              <p className="app-muted" style={{ margin: 0 }}>
                Linked as {githubLogin ?? "GitHub"} · read-only. Pick the robot-code repo to scan.
              </p>
              <label>
                Repository
                <select
                  value={selectedRepo}
                  onChange={(event) => {
                    const next = event.target.value;
                    setSelectedRepo(next);
                    const meta = repos.find((repo) => repo.fullName === next);
                    if (meta?.defaultBranch) setSelectedRef(meta.defaultBranch);
                  }}
                  aria-label="GitHub repository"
                >
                  {!selectedRepo ? <option value="">Select a repository</option> : null}
                  {repos.map((repo) => (
                    <option key={repo.fullName} value={repo.fullName}>
                      {repo.fullName}
                      {repo.private ? " (private)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              {githubEmptyReason && !repos.length ? <p className="app-muted">{githubEmptyReason}</p> : null}
              {robotFiles.length ? (
                <label>
                  Robot-code files
                  <select
                    defaultValue=""
                    onChange={(event) => {
                      const filePath = event.target.value;
                      if (filePath) void loadGithubFile(filePath);
                    }}
                    aria-label="GitHub robot-code file"
                  >
                    <option value="">Load one file into the editor</option>
                    {robotFiles.map((file) => (
                      <option key={file} value={file}>
                        {file}
                      </option>
                    ))}
                  </select>
                </label>
              ) : selectedRepo ? (
                <p className="app-muted">
                  {treeTruncated
                    ? "Tree listing truncated — no robot-code files in the first slice."
                    : "No .java / .cpp / .py files visible in this tree yet."}
                </p>
              ) : null}
            </div>
          )}

          {/*
            The scan plan is free: it answers "what will you read, what will you
            skip, and what does it cost" BEFORE any metered call. A team should
            never discover the price or the coverage after the fact.
          */}
          {githubConnected && selectedRepo ? (
            <section className="cdc-scan-plan" aria-label="Scan plan">
              {planLoading ? (
                <p className="app-muted" style={{ margin: 0 }}>
                  Planning a scan of {selectedRepo}…
                </p>
              ) : scanPlan ? (
                <>
                  <header className="cdc-scan-plan-head">
                    <strong>
                      Scan plan · {scanPlan.repo}@{scanPlan.sha ? scanPlan.sha.slice(0, 7) : scanPlan.ref}
                    </strong>
                    <span className={`cdc-scan-cost ${bugbotMode === "ultra" ? "paid" : "included"}`}>
                      {bugbotMode === "ultra"
                        ? `$${scanPlan.cost.totalUsd.toFixed(2)} · $${scanPlan.cost.perChunkUsd.toFixed(2)} × ${scanPlan.chunkCount} chunk${scanPlan.chunkCount === 1 ? "" : "s"}`
                        : `${scanPlan.chunkCount} metered call${scanPlan.chunkCount === 1 ? "" : "s"} on your subscription / BYO key`}
                    </span>
                  </header>
                  <p className="app-muted" style={{ margin: 0 }}>
                    Will read {scanPlan.reviewed.length} robot-code file
                    {scanPlan.reviewed.length === 1 ? "" : "s"} of {scanPlan.candidateCount} found, {scanPlan.chunkFiles} per
                    chunk, entry points first.
                    {scanPlan.deferredCount > 0
                      ? ` ${scanPlan.deferredCount} file${scanPlan.deferredCount === 1 ? "" : "s"} will NOT be reached by this scan's chunk budget.`
                      : ""}
                    {scanPlan.treeTruncated ? " GitHub truncated the tree listing for this repo." : ""}
                  </p>
                  {scanPlan.skipCounts.length ? (
                    <ul className="cdc-skip-list" aria-label="Files this scan will skip">
                      {scanPlan.skipCounts.map((item) => (
                        <li key={item.reason}>
                          <strong>{item.count}</strong> {item.label}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <button
                    type="button"
                    className="app-button ghost cdc-coverage-toggle"
                    aria-expanded={showCoverage}
                    onClick={() => setShowCoverage((prev) => !prev)}
                  >
                    {showCoverage ? "Hide the file list" : "Show exactly which files"}
                  </button>
                  {showCoverage ? (
                    <div className="cdc-coverage-detail">
                      <div>
                        <h4>Reviewed</h4>
                        <ol>
                          {scanPlan.reviewed.map((item) => (
                            <li key={item.path}>
                              <code>{item.path}</code>
                              <small className="app-muted">
                                {item.role.replace(/_/g, " ")} · chunk {item.chunk + 1}
                              </small>
                            </li>
                          ))}
                        </ol>
                      </div>
                      <div>
                        <h4>Skipped</h4>
                        <ol>
                          {scanPlan.skipped.slice(0, 60).map((item) => (
                            <li key={item.path}>
                              <code>{item.path}</code>
                              <small className="app-muted">{item.reason.replace(/_/g, " ")}</small>
                            </li>
                          ))}
                        </ol>
                        {scanPlan.skipped.length > 60 || scanPlan.skippedListTruncated ? (
                          <p className="app-muted">
                            Listing the first 60 skipped paths — the counts above cover every file in the tree.
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </>
              ) : scanPlanReason ? (
                <p className="app-muted" style={{ margin: 0 }}>
                  {scanPlanReason}
                </p>
              ) : null}
            </section>
          ) : null}

          <footer className="cdc-bugbot-actions">
            <button
              type="button"
              className="primary-action"
              disabled={busy || !orgId || !hasSource}
              onClick={() => void runBugbot({ mode: bugbotMode, phase: "scan", scanRepo: false })}
            >
              {bugbotMode === "ultra" ? `Scan file · $${BUGBOT_ULTRA_PRICES_USD.scan.toFixed(2)}` : "Scan this file"}
            </button>
            <button
              type="button"
              className="app-button secondary"
              disabled={busy || !orgId || !githubConnected || !selectedRepo}
              onClick={() => void runBugbot({ mode: bugbotMode, phase: "scan", scanRepo: true })}
            >
              {bugbotMode === "ultra"
                ? `Scan repo · $${(scanPlan?.cost.totalUsd ?? BUGBOT_ULTRA_PRICES_USD.scan).toFixed(2)}`
                : scanPlan
                  ? `Scan connected repo · ${scanPlan.chunkCount} chunk${scanPlan.chunkCount === 1 ? "" : "s"}`
                  : "Scan connected repo"}
            </button>
            {lastScan?.scanRepo ? (
              // After a repo scan a fix is per finding: it re-reads the file that
              // owns the finding at the scanned commit, never "chunk 0".
              <span className="app-muted" style={{ fontSize: 12, alignSelf: "center" }}>
                {bugbot?.findings.length
                  ? "Propose a fix from a finding row below (Fix this / Fix all in file)."
                  : "No findings to fix in the scanned repo."}
              </span>
            ) : (
              <button
                type="button"
                className="app-button secondary"
                disabled={busy || !orgId || !hasSource}
                onClick={() => void runBugbot({ mode: bugbotMode, phase: "fix", scanRepo: false })}
              >
                {bugbotMode === "ultra" ? `Propose fix · $${BUGBOT_ULTRA_PRICES_USD.fix.toFixed(2)}` : "Propose fix"}
              </button>
            )}
            <button
              type="button"
              className="app-button secondary"
              disabled={busy || !orgId || (!hasSource && !lastScan?.scanRepo)}
              onClick={() => void runBugbot({ mode: bugbotMode, phase: "recheck", scanRepo: false })}
            >
              {bugbotMode === "ultra"
                ? `Recheck${lastScan?.scanRepo && (scanPlan?.chunkCount ?? 1) > 1 ? " repo" : ""} · $${(BUGBOT_ULTRA_PRICES_USD.recheck * (lastScan?.scanRepo ? Math.max(1, scanPlan?.chunkCount ?? 1) : 1)).toFixed(2)}`
                : lastScan?.scanRepo && (scanPlan?.chunkCount ?? 1) > 1
                  ? `Recheck repo · ${scanPlan?.chunkCount} chunks`
                  : "Recheck"}
            </button>
          </footer>
          {lastScan?.scanRepo ? (
            <p className="app-muted" style={{ margin: 0, fontSize: 12 }}>
              Fix and recheck target the scanned repo{lastScan.repo ? ` ${lastScan.repo}` : ""}
              {lastScan.sha ? ` (fix pinned to ${lastScan.sha.slice(0, 7)})` : ""} — not the editor buffer. A
              per-finding fix or recheck re-reads only that finding&apos;s file
              {bugbotMode === "ultra"
                ? ` ($${BUGBOT_ULTRA_PRICES_USD.fix.toFixed(2)} fix, waived when no grounded diff comes back; $${BUGBOT_ULTRA_PRICES_USD.recheck.toFixed(2)} recheck)`
                : ""}
              .
            </p>
          ) : null}

          {/* Running cost and coverage while a chunked scan is in flight. */}
          {progress ? (
            <section
              className={`cdc-scan-progress${progress.partial ? " partial" : ""}`}
              aria-label="Scan progress"
              aria-live="polite"
            >
              <div
                className="cdc-scan-bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={progress.chunkCount}
                aria-valuenow={progress.chunkIndex}
                aria-valuetext={`chunk ${progress.chunkIndex} of ${progress.chunkCount}`}
              >
                <span
                  style={{
                    width: `${Math.round((progress.chunkIndex / Math.max(1, progress.chunkCount)) * 100)}%`,
                  }}
                />
              </div>
              <p style={{ margin: 0 }}>
                {progress.running ? "Scanning" : "Scan finished"} · chunk {progress.chunkIndex} of{" "}
                {progress.chunkCount}
                {bugbotMode === "ultra" ? ` · $${progress.spentUsd.toFixed(2)} spent so far` : ""}
              </p>
              {progress.partial && progress.partialReason ? (
                <p className="cdc-partial-note" style={{ margin: 0 }}>
                  <strong>Partial coverage.</strong> {progress.partialReason}. Findings below cover only the files
                  that were actually read — this is not a clean bill of health for the repo.
                </p>
              ) : null}
            </section>
          ) : null}

          {/* What the finished pass read, and the NEW / KNOWN / FIXED delta. */}
          {coverage && coverage.reviewedFiles.length ? (
            <section className="cdc-coverage" aria-label="Scan coverage">
              <p style={{ margin: 0 }}>
                Reviewed {coverage.reviewedFiles.length} file
                {coverage.reviewedFiles.length === 1 ? "" : "s"}
                {coverage.candidateCount > coverage.reviewedFiles.length
                  ? ` of ${coverage.candidateCount} robot-code files`
                  : ""}
                .
              </p>
              {coverage.truncated && coverage.truncatedFiles?.length ? (
                <details className="cdc-partial-note">
                  <summary>
                    <strong>Read cap hit.</strong> {coverage.truncatedFiles.length} file
                    {coverage.truncatedFiles.length === 1 ? " was" : "s were"} cut before the end — the model never
                    saw the rest, so findings past the cut are not covered.
                  </summary>
                  <ul>
                    {coverage.truncatedFiles.map((file) => (
                      <li key={file}>
                        <code>{file}</code>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {delta ? (
                <p className="cdc-delta" style={{ margin: 0 }}>
                  <span className="cdc-delta-chip new">{delta.new} new</span>
                  <span className="cdc-delta-chip known">{delta.known} known</span>
                  <span className="cdc-delta-chip fixed">{delta.fixed} fixed</span>
                </p>
              ) : null}
              {fixedFindings.length ? (
                <details>
                  <summary>
                    Fixed since the last scan ({fixedFindings.length})
                  </summary>
                  <ul>
                    {fixedFindings.map((item) => (
                      <li key={item.fingerprint}>
                        <code>{item.filePath}</code> — {item.finding}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              <details>
                <summary>Files read this pass ({coverage.reviewedFiles.length})</summary>
                <ol>
                  {coverage.reviewedFiles.map((file) => (
                    <li key={file}>
                      <code>{file}</code>
                    </li>
                  ))}
                </ol>
              </details>
              {coverage.skipCounts.length ? (
                <details>
                  <summary>
                    Skipped, and why ({coverage.skipCounts.reduce((sum, item) => sum + item.count, 0)})
                  </summary>
                  <ul>
                    {coverage.skipCounts.map((item) => (
                      <li key={item.reason}>
                        <strong>{item.count}</strong> {item.label}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </section>
          ) : null}

          {bugbotMeta?.proposedDiff ? (
            <div className="cdc-proposal">
              <span>Proposed fix · human approval required</span>
              <strong>
                Never pushed to GitHub · never deployed
                {bugbotMeta.githubSha
                  ? ` · fixed against ${bugbotMeta.githubRepo ? `${bugbotMeta.githubRepo}@` : ""}${bugbotMeta.githubSha.slice(0, 7)}`
                  : ""}
              </strong>
              {bugbotMeta.branchMoved ? (
                <p className="app-muted" style={{ margin: 0, fontSize: 12 }}>
                  Branch moved since that scan — this diff targets the scanned commit. Rescan recommended before
                  applying.
                </p>
              ) : null}
              <pre aria-label="Bugbot unified diff">{bugbotMeta.proposedDiff}</pre>
            </div>
          ) : null}

          {bugbot ? (
            bugbot.findings.length === 0 ? (
              <EmptyState
                soft
                badge="Clear"
                badgeTone="good"
                title="No grounded Bugbot findings"
                description="Nothing quoted from this source survived. Empty is not certification — still simulate before enable."
              />
            ) : (
              <div className="cdc-bugbot-table-wrap">
                <table className="cdc-bugbot-table">
                  <caption className="visually-hidden">AI Bugbot findings</caption>
                  <thead>
                    <tr>
                      <th>Severity</th>
                      <th>Location</th>
                      <th>Finding</th>
                      <th>Triage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bugbot.findings.map((item, index) => {
                      // Per-finding targeting: a fix or recheck re-reads THIS
                      // file (the server maps it to the chunk that owns it), and
                      // only this file's findings travel with the request.
                      const file = bugbotFindingFile(item);
                      const inFile = bugbot.findings.filter((other) => bugbotFindingFile(other) === file);
                      const firstOfFile =
                        bugbot.findings.findIndex((other) => bugbotFindingFile(other) === file) === index;
                      const chunk = scanPlan?.reviewed.find((planned) => planned.path === file)?.chunk;
                      const fixLabel = bugbotMode === "ultra" ? ` · $${BUGBOT_ULTRA_PRICES_USD.fix.toFixed(2)}` : "";
                      const recheckLabel =
                        bugbotMode === "ultra" ? ` · $${BUGBOT_ULTRA_PRICES_USD.recheck.toFixed(2)}` : "";
                      return (
                        <tr key={item.fingerprint ?? `${item.location}-${index}`}>
                          <td>
                            <span className={`cdc-severity ${item.severity}`}>{item.severity}</span>
                            <small className="app-muted">{item.source === "model" ? "model" : "local"}</small>
                          </td>
                          <td>
                            <code>{item.location}</code>
                            {item.delta ? (
                              <small className={`cdc-delta-chip ${item.delta}`}>{item.delta}</small>
                            ) : null}
                          </td>
                          <td>
                            <p style={{ margin: 0 }}>{item.finding}</p>
                            <code>{item.evidence}</code>
                          </td>
                          <td>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                              <button
                                type="button"
                                className="app-button ghost"
                                disabled={busy || !orgId}
                                title={`Propose a human-approved diff for this finding — re-reads ${file}${chunk != null ? ` (chunk ${chunk + 1})` : ""}. Never pushed.`}
                                onClick={() =>
                                  void runBugbot({
                                    mode: bugbotMode,
                                    phase: "fix",
                                    scanRepo: false,
                                    target: {
                                      filePath: file,
                                      chunkIndex: chunk,
                                      fingerprints: item.fingerprint ? [item.fingerprint] : undefined,
                                    },
                                  })
                                }
                              >
                                Fix this{fixLabel}
                              </button>
                              {firstOfFile && inFile.length > 1 ? (
                                <button
                                  type="button"
                                  className="app-button ghost"
                                  disabled={busy || !orgId}
                                  title={`One diff addressing all ${inFile.length} findings in ${file}.`}
                                  onClick={() =>
                                    void runBugbot({
                                      mode: bugbotMode,
                                      phase: "fix",
                                      scanRepo: false,
                                      target: { filePath: file, chunkIndex: chunk },
                                    })
                                  }
                                >
                                  Fix all in file ({inFile.length}){fixLabel}
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className="app-button ghost"
                                disabled={busy || !orgId}
                                title={`Re-read ${file} at the current head and report what is still there.`}
                                onClick={() =>
                                  void runBugbot({
                                    mode: bugbotMode,
                                    phase: "recheck",
                                    scanRepo: false,
                                    target: { filePath: file, chunkIndex: chunk },
                                  })
                                }
                              >
                                Recheck file{recheckLabel}
                              </button>
                              {item.fingerprint ? (
                                <button
                                  type="button"
                                  className="app-button ghost"
                                  disabled={busy}
                                  onClick={() => {
                                    setDismissTarget(item);
                                    setDismissReason("");
                                  }}
                                >
                                  Dismiss
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {dismissTarget ? (
                  <form
                    className="cdc-dismiss-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submitDismissal();
                    }}
                  >
                    <p style={{ margin: 0 }}>
                      Dismiss <code>{dismissTarget.location}</code> — why is this one fine?
                    </p>
                    <label>
                      <span className="visually-hidden">Dismissal reason</span>
                      <input
                        value={dismissReason}
                        onChange={(event) => setDismissReason(event.target.value)}
                        placeholder="e.g. deliberate — the limit is set in Constants.java"
                        maxLength={500}
                        aria-label="Dismissal reason"
                      />
                    </label>
                    <div className="cdc-dismiss-actions">
                      <button type="submit" className="primary-action" disabled={busy || dismissReason.trim().length < 3}>
                        Dismiss this finding
                      </button>
                      <button
                        type="button"
                        className="app-button ghost"
                        onClick={() => {
                          setDismissTarget(null);
                          setDismissReason("");
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                    <p className="app-muted" style={{ margin: 0, fontSize: 12 }}>
                      Kept against this finding&apos;s fingerprint, so it stays dismissed across commits even when
                      the line moves. Restore it any time.
                    </p>
                  </form>
                ) : null}
                {bugbot.droppedUngrounded > 0 ? (
                  <p className="app-muted">
                    Dropped {bugbot.droppedUngrounded} ungrounded model claim{bugbot.droppedUngrounded === 1 ? "" : "s"} that
                    did not quote this source.
                  </p>
                ) : null}
              </div>
            )
          ) : orgId ? (
            <EmptyState
              soft
              badge="Idle"
              badgeTone="setup"
              title="No Bugbot pass yet"
              description="Scan a connected repo or this file. Subscription uses your key. Ultra is the published hosted SKU. Findings stay empty until evidence is in the source."
            >
              <a className="app-button secondary" href={githubHref}>
                GitHub connection
              </a>
            </EmptyState>
          ) : null}
          {bugbotNarrations.length ? (
            <WhyPanel
              narrations={bugbotNarrations}
              orgId={orgId || undefined}
              title="Why Bugbot flagged this"
              subtitle={`${bugbotNarrations.length} grounded finding${bugbotNarrations.length === 1 ? "" : "s"} · every quote comes from your own source`}
            />
          ) : null}
          {dismissals.length ? (
            <details className="cdc-dismissals">
              <summary>Dismissed findings ({dismissals.length})</summary>
              <ul>
                {dismissals.map((item) => (
                  <li key={item.fingerprint}>
                    <div>
                      <code>{item.filePath ?? "—"}</code>
                      <span className="app-muted"> — {item.reason}</span>
                    </div>
                    <button
                      type="button"
                      className="app-button ghost"
                      disabled={busy}
                      onClick={() => void restoreDismissal(item.fingerprint)}
                    >
                      Restore
                    </button>
                  </li>
                ))}
              </ul>
              <p className="app-muted">
                Dismissals are kept per finding fingerprint, so they survive new commits and moved lines.
              </p>
            </details>
          ) : null}

          {history.length ? (
            <ol className="cdc-bugbot-history" aria-label="Recent Bugbot runs">
              {history.slice(0, 6).map((row) => (
                <li key={row.id}>
                  <strong>{row.path}</strong>
                  <span>
                    {row.tier ?? "subscription"} · {row.phase ?? "scan"} · {row.riskLevel} · {row.localRiskCount} local ·{" "}
                    {row.modelFindingCount} model
                    {row.newFindingCount != null || row.knownFindingCount != null || row.fixedFindingCount != null
                      ? ` · ${row.newFindingCount ?? 0} new / ${row.knownFindingCount ?? 0} known / ${row.fixedFindingCount ?? 0} fixed`
                      : ""}
                    {(row.chunkCount ?? 1) > 1 ? ` · chunk ${(row.chunkIndex ?? 0) + 1}/${row.chunkCount}` : ""}
                    {row.githubSha ? ` · ${row.githubSha.slice(0, 7)}` : ""}
                    {row.chargeUsd && Number(row.chargeUsd) > 0 ? ` · $${Number(row.chargeUsd).toFixed(2)}` : ""}
                    {row.model ? ` · ${row.model}` : ""}
                  </span>
                  {row.partial ? (
                    <span className="cdc-partial-tag" title={row.partialReason ?? undefined}>
                      partial coverage
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : null}
        </article>
      </section>
    </main>
  );
}
