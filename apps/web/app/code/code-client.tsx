"use client";

import "./code.css";
import { useEffect, useMemo, useState } from "react";
import { isBugbotScanPath } from "@vantage/agent/bugbot";
import { buildDiffProposal, reviewFrcCode } from "@vantage/agent/coding-assistant";
import { narrateCodeFindings } from "../../lib/agent-narration/narration";
import { resolveCutoffErrorCode } from "../../components/usage-cutoff-banner";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import { githubConnectionHref } from "../../lib/github/github-related";
import {
  bugbotBilledNote,
  enforceBugbotFileCap,
  prepareBugbotWritePr,
  resolveBugbotTarget,
  type BugbotScanTarget,
} from "../../lib/bugbot";
import { useCockpitPrefs } from "../../lib/cockpit/use-cockpit-prefs";
import {
  describeBugbotCoverage,
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
import {
  EMPTY_COVERAGE,
  type BugbotFinding,
  type BugbotHistoryRow,
  type BugbotMeta,
  type BugbotMode,
  type BugbotPhase,
  type BugbotResponse,
  type BugbotReview,
  type Dismissal,
  type FixedFinding,
  type GitHubRepoOption,
  type Proposal,
  type Review,
  type ScanCoverage,
  type ScanPlan,
  type ScanProgress,
} from "./code-model";
import { CodeReadyView } from "./code-ready-view";

export function CodeClient({
  orgId = "",
  related = "build",
  embedded = false,
  focusBugbot = false,
}: {
  orgId?: string;
  /** Soft-UI related strip: Build hub vs AI hub embedding. */
  related?: "build" | "ai";
  embedded?: boolean;
  /** Scroll the Bugbot workbench into view when opened from the Bugbot hub tab. */
  focusBugbot?: boolean;
}) {
  const cockpit = useCockpitPrefs();
  const [path, setPath] = useState("src/main/java/frc/robot/subsystems/DriveSubsystem.java");
  const [content, setContent] = useState(CODE_COACH_SAMPLE);
  const [review, setReview] = useState<Review | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [bugbot, setBugbot] = useState<BugbotReview | null>(null);
  const [bugbotMeta, setBugbotMeta] = useState<BugbotMeta | null>(null);
  /** What the last Bugbot scan actually ran against — a paid fix must target the same source. */
  const [lastScan, setLastScan] = useState<BugbotScanTarget | null>(null);
  const [history, setHistory] = useState<BugbotHistoryRow[]>([]);
  const [cutoffCode, setCutoffCode] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bugbotMode, setBugbotMode] = useState<BugbotMode>("subscription");
  const [instructions, setInstructions] = useState("");
  const [includeScanTests, setIncludeScanTests] = useState(false);
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
  const [writePrConfirming, setWritePrConfirming] = useState(false);
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
  const robotFiles = useMemo(
    () => enforceBugbotFileCap(repoFiles.filter((file) => isBugbotScanPath(file))).included,
    [repoFiles],
  );

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
    if (!focusBugbot) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById("bugbot")?.scrollIntoView({ block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusBugbot]);

  useEffect(() => {
    setBugbotMode(cockpit.defaultBugbotMode);
    setInstructions(cockpit.bugbotInstructions);
    setIncludeScanTests(cockpit.includeScanTests);
  }, [cockpit.defaultBugbotMode, cockpit.bugbotInstructions, cockpit.includeScanTests]);

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
      includeTests: includeScanTests ? "1" : "0",
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
  }, [orgId, githubConnected, selectedRepo, selectedRef, bugbotMode, includeScanTests]);

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

  async function runBugbot(options?: { mode?: BugbotMode; phase?: BugbotPhase; scanRepo?: boolean }) {
    const mode = options?.mode ?? bugbotMode;
    const phase = options?.phase ?? "scan";
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
      setMessage("Choose your team before running Bugbot.");
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
    const isRepoScan = useRepo && (phase === "scan" || phase === "recheck");
    const plannedChunks = isRepoScan ? Math.max(1, scanPlan?.chunkCount ?? 1) : 1;

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
    const operationRequestId = crypto.randomUUID();
    const startedAt = Date.now();

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
          findings: bugbot?.findings,
          chunkIndex,
          spentUsd,
          requestId: `${operationRequestId}:chunk:${chunkIndex}`,
          parentReviewId: history[0]?.id && history[0].id !== "latest" ? history[0].id : undefined,
          includeTests: includeScanTests,
          customInstructions: instructions.trim() || undefined,
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
        reviewId: data.reviewId,
        filesScanned: data.filesScanned,
        elapsedMs: Date.now() - startedAt,
        githubRepo: data.githubRepo ?? (useRepo ? targetRepo ?? null : null),
        githubSha: data.githubSha ?? null,
        branchMoved: Boolean(data.branchMoved),
        repoOverview: data.repoOverview ?? null,
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
      setWritePrConfirming(false);
    }

    function billedNote(chargeUsd: number | undefined, modeUsed: BugbotMode | undefined): string {
      return bugbotBilledNote(modeUsed, chargeUsd);
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
          // Single-call phases (file scan, fix, buffer recheck) render directly.
          setBugbot(data.review);
          setProgress(null);
          setCoverage(data.coverage ?? null);
          setDelta(data.delta ? { new: data.delta.new, known: data.delta.known, fixed: data.delta.fixed } : null);
          setFixedFindings(data.delta?.fixedFindings ?? []);
          const billed = billedNote(data.chargeUsd, data.mode);
          const shaShort = data.githubSha ? data.githubSha.slice(0, 7) : null;
          const grounded =
            useRepo && shaShort ? ` Source: ${data.githubRepo ?? targetRepo ?? "repo"}@${shaShort}.` : "";
          const moved = data.branchMoved ? " Branch moved since that scan — rescan recommended." : "";
          if (phase === "fix") {
            setMessage(
              data.proposedDiff
                ? `Grounded fix ready — human approval required. Never pushed to GitHub.${grounded}${moved}${billed}`
                : `No grounded diff (unquoted removals dropped). Nothing was pushed.${grounded}${moved}${billed}`,
            );
          } else {
            setMessage(
              data.review.findings.length
                ? `Bugbot ${phase}: ${data.review.findings.length} grounded finding${data.review.findings.length === 1 ? "" : "s"} (${data.review.localRiskCount} local · ${data.review.modelFindingCount} model). Ungrounded claims dropped: ${data.review.droppedUngrounded}.${grounded}${moved}${billed} Never deploys.`
                : `Bugbot ${phase} complete — no grounded findings.${grounded}${moved}${billed} Empty is not certification.`,
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
            : bugbotBilledNote("subscription");
        const found = run.findings.length
          ? `${run.findings.length} grounded finding${run.findings.length === 1 ? "" : "s"} (${run.newCount} new · ${run.knownCount} known · ${run.fixedCount} fixed)`
          : "no grounded findings";
        setBugbotMeta((prev) => (prev ? { ...prev, elapsedMs: Date.now() - startedAt } : prev));
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

  async function requestWritePr() {
    if (!orgId || !bugbotMeta?.proposedDiff) return;
    try {
      const draft = prepareBugbotWritePr({
        phase: "fix",
        lastScan,
        humanApproved: writePrConfirming || !cockpit.confirmWrites,
        unifiedDiff: bugbotMeta.proposedDiff,
      });
      if (cockpit.confirmWrites && !writePrConfirming) {
        setWritePrConfirming(true);
        setMessage(
          `Approve opening a pull request on ${draft.repo}@${draft.baseSha.slice(0, 7)}? This uses the scanned commit, not the editor.`,
        );
        return;
      }
      const reviewId =
        bugbotMeta.reviewId ?? (history[0]?.id && history[0].id !== "latest" ? history[0].id : undefined);
      if (!reviewId) {
        setMessage("Save a fix review before opening a pull request.");
        return;
      }
      setBusy(true);
      const response = await fetch("/bugbot/pr", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, reviewId, humanApproved: true }),
      });
      const data = (await response.json()) as { error?: string; htmlUrl?: string; number?: number };
      if (!response.ok) {
        setMessage(data.error ?? "Could not open the pull request.");
        return;
      }
      setWritePrConfirming(false);
      setMessage(
        data.htmlUrl
          ? `Opened pull request #${data.number} on ${draft.repo}. Never merged. ${data.htmlUrl}`
          : `Opened pull request #${data.number} on ${draft.repo}. Never merged.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not open the pull request.");
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
            ? `Matched ${nextReview.risks.length} pattern${nextReview.risks.length === 1 ? "" : "s"}. Open the notes — a mentor writes the change after reading them.`
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
    <CodeReadyView
      orgId={orgId}
      related={related}
      embedded={embedded}
      relatedLinks={relatedLinks}
      budgetsHref={budgetsHref}
      keysHref={keysHref}
      githubHref={githubHref}
      showMeteredBanner={showMeteredBanner}
      cutoffCode={cutoffCode}
      nextActions={nextActions}
      message={message}
      hasSource={hasSource}
      path={path}
      setPath={setPath}
      content={content}
      setContent={setContent}
      setReview={setReview}
      setProposal={setProposal}
      setMessage={setMessage}
      busy={busy}
      runReview={runReview}
      runPropose={runPropose}
      runBugbot={(options) => void runBugbot(options)}
      review={review}
      proposal={proposal}
      coachNarrations={coachNarrations}
      bugbotMode={bugbotMode}
      setBugbotMode={setBugbotMode}
      bugbotMeta={bugbotMeta}
      includeScanTests={includeScanTests}
      setIncludeScanTests={setIncludeScanTests}
      cockpit={cockpit}
      instructions={instructions}
      setInstructions={setInstructions}
      githubConnected={githubConnected}
      githubLogin={githubLogin}
      selectedRepo={selectedRepo}
      setSelectedRepo={setSelectedRepo}
      repos={repos}
      setSelectedRef={setSelectedRef}
      githubEmptyReason={githubEmptyReason}
      robotFiles={robotFiles}
      loadGithubFile={(filePath) => void loadGithubFile(filePath)}
      treeTruncated={treeTruncated}
      planLoading={planLoading}
      scanPlan={scanPlan}
      showCoverage={showCoverage}
      setShowCoverage={setShowCoverage}
      scanPlanReason={scanPlanReason}
      lastScan={lastScan}
      requestWritePr={() => void requestWritePr()}
      writePrConfirming={writePrConfirming}
      progress={progress}
      coverage={coverage}
      delta={delta}
      fixedFindings={fixedFindings}
      bugbot={bugbot}
      dismissTarget={dismissTarget}
      setDismissTarget={setDismissTarget}
      dismissReason={dismissReason}
      setDismissReason={setDismissReason}
      submitDismissal={() => void submitDismissal()}
      bugbotNarrations={bugbotNarrations}
      dismissals={dismissals}
      restoreDismissal={(fingerprint) => void restoreDismissal(fingerprint)}
      history={history}
    />
  );
}
