"use client";

import { useEffect, useMemo, useState } from "react";
import { BUGBOT_ULTRA_PRICES_USD, isBugbotScanPath } from "@vantage/agent/bugbot";
import { buildDiffProposal, reviewFrcCode } from "@vantage/agent/coding-assistant";
import { AiHubRelated } from "../../components/ai-hub-related";
import { BuildHubRelated } from "../../components/build-hub-related";
import { EmptyState } from "../../components/ui";
import { MeteredAiCutoffBanner } from "../../components/metered-ai-cutoff-banner";
import {
  resolveCutoffErrorCode,
  UsageCutoffBanner,
} from "../../components/usage-cutoff-banner";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import { githubConnectionHref } from "../../lib/github/github-related";
import {
  CODE_COACH_RELATED_INCLUDE,
  CODE_COACH_SAMPLE,
  codeCoachNextActions,
  codeCoachRelatedLinks,
  groundedCodeCoachProposal,
} from "../../lib/code/code-related";

/** Teach-not-do lessons keyed by coding-assistant pattern ids — only shown when a rule matched. */
const COACH_LESSONS: Record<string, { flag: string; explain: string; habit: string }> = {
  "blocking-robot-loop": {
    flag: "Blocking call inside the robot loop",
    explain: "Timer.delay / Thread.sleep stalls command scheduling, sensor reads, and safety feeds for the entire delay.",
    habit: "Use timestamps or stateful commands so the loop keeps running while work advances on a schedule.",
  },
  "hardcoded-can-id": {
    flag: "Hard-coded CAN device construction",
    explain: "Inline IDs collide when two subsystems claim the same bus address or a map drifts from the wiring sheet.",
    habit: "Keep one reviewed hardware map (constants / generated config) and construct devices from that map only.",
  },
  "unbounded-motor-output": {
    flag: "Motor output outside a normalized range",
    explain: "Raw set() values beyond ±1 (or vendor limits) can demand unsafe current or saturate control unexpectedly.",
    habit: "Clamp demands or use typed control requests (DutyCycleOut, VoltageOut) with explicit units and soft limits.",
  },
  "missing-unit-signal": {
    flag: "Physical value without a unit signal",
    explain: "Bare numbers for distance/velocity/angle invite inch/meter mix-ups under match pressure.",
    habit: "Use WPILib units or encode the unit in the name (metersPerSecond, degrees) so reviews catch scale errors.",
  },
  "disabled-state-mutation": {
    flag: "Actuator write in a disabled callback",
    explain: "Output during disabledInit/Periodic can move mechanisms when the robot should be safe.",
    habit: "Keep disabled paths read-only unless a mentor-reviewed safety procedure explicitly allows a hold/brake.",
  },
  "missing-supply-current-limit": {
    flag: "Motor constructed without a supply current limit",
    explain: "Uncapped swerve and mechanisms brown out the RIO and trip the main breaker. Supply limits protect the battery; stator limits protect the motor.",
    habit: "Set supply current limits on every motor in the same file that constructs the controller — never deploy without them.",
  },
};

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
  } | null>(null);
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

  useEffect(() => {
    if (!orgId) return;
    void fetch(`/api/code?orgId=${encodeURIComponent(orgId)}`)
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as {
          reviews?: BugbotHistoryRow[];
          github?: {
            connected?: boolean;
            login?: string | null;
            defaultRepoFullName?: string | null;
            defaultRepoDefaultBranch?: string | null;
          };
        };
        setHistory(data.reviews ?? []);
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
      setMessage(`Loaded ${selectedRepo}:${data.file.path} (read-only).`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load GitHub file");
    } finally {
      setBusy(false);
    }
  }

  async function runBugbot(options?: { mode?: BugbotMode; phase?: BugbotPhase; scanRepo?: boolean }) {
    const mode = options?.mode ?? bugbotMode;
    const phase = options?.phase ?? "scan";
    const scanRepo = Boolean(options?.scanRepo);
    if (!scanRepo && !content.trim()) {
      setMessage("Paste robot source, load a GitHub file, or scan the connected repo.");
      return;
    }
    if (!orgId) {
      setMessage("Choose a workspace before running Bugbot.");
      return;
    }
    if (scanRepo && !githubConnected) {
      setMessage("Connect GitHub in Team admin before scanning a repo.");
      return;
    }
    setBusy(true);
    setCutoffCode(null);
    setMessage(null);
    try {
      const response = await fetch("/api/code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "bugbot",
          path,
          content: scanRepo ? undefined : content,
          orgId,
          mode,
          phase,
          scanRepo,
          githubRepo: selectedRepo || undefined,
          githubRef: selectedRef || undefined,
          githubPath: !scanRepo && path && githubConnected ? path : undefined,
          findings: bugbot?.findings,
          parentReviewId: history[0]?.id && history[0].id !== "latest" ? history[0].id : undefined,
        }),
      });
      const data = (await response.json()) as {
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
        filesScanned?: number;
        fixDropped?: boolean;
      };
      if (!response.ok) {
        const cutoff = resolveCutoffErrorCode(response.status, {
          code: data.code,
          reason: data.reason,
          error: data.error,
          hardCutoff: data.hardCutoff,
        });
        if (cutoff) setCutoffCode(cutoff);
        setMessage(typeof data.error === "string" ? data.error : "AI Bugbot failed.");
        return;
      }
      if (data.review) {
        setBugbot(data.review);
        setBugbotMeta({
          provider: data.provider,
          model: data.model,
          mode: data.mode ?? mode,
          phase: data.phase ?? phase,
          chargeUsd: data.chargeUsd,
          proposedDiff: data.proposedDiff,
          filesScanned: data.filesScanned,
        });
        const billed =
          data.mode === "ultra" && data.chargeUsd
            ? ` Charged $${Number(data.chargeUsd).toFixed(2)} Bugbot Ultra.`
            : " Uses your subscription / BYO key.";
        if (phase === "fix") {
          setMessage(
            data.proposedDiff
              ? `Grounded fix ready — human approval required. Never pushed to GitHub.${billed}`
              : `No grounded diff (unquoted removals dropped). Nothing was pushed.${billed}`,
          );
        } else {
          setMessage(
            data.review.findings.length
              ? `Bugbot ${phase}: ${data.review.findings.length} grounded finding${data.review.findings.length === 1 ? "" : "s"} (${data.review.localRiskCount} local · ${data.review.modelFindingCount} model). Ungrounded claims dropped: ${data.review.droppedUngrounded}.${billed} Never deploys.`
              : `Bugbot ${phase} complete — no grounded findings.${billed} Empty is not certification.`,
          );
        }
        setHistory((prev) => [
          {
            id: "latest",
            path: data.review!.path,
            riskLevel: data.review!.riskLevel,
            localRiskCount: data.review!.localRiskCount,
            modelFindingCount: data.review!.modelFindingCount,
            droppedUngrounded: data.review!.droppedUngrounded,
            provider: data.provider ?? null,
            model: data.model ?? null,
            createdAt: new Date().toISOString(),
            tier: data.mode,
            phase: data.phase,
            filesScanned: data.filesScanned,
            chargeUsd: data.chargeUsd != null ? String(data.chargeUsd) : undefined,
          },
          ...prev.filter((row) => row.id !== "latest"),
        ].slice(0, 12));
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "AI Bugbot failed");
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
              AI API keys
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
              <a className="app-button secondary" href={action.href}>
                Open
              </a>
            </li>
          ))}
        </ol>
      </section>

      <section className="cdc-flow" aria-label="Teach, don't just do">
        <article>
          <b>01 · Flag</b>
          <h2>Catch the risky line</h2>
          <p>Blocking loops, hard-coded CAN IDs, unbounded motor output, missing units, disabled-state writes.</p>
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
                  {review.risks.map((risk) => {
                    const lesson = COACH_LESSONS[risk.pattern];
                    return (
                      <li className="cdc-finding" key={risk.pattern}>
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
              {bugbotMode === "ultra" ? `Scan repo · $${BUGBOT_ULTRA_PRICES_USD.scan.toFixed(2)}` : "Scan connected repo"}
            </button>
            <button
              type="button"
              className="app-button secondary"
              disabled={busy || !orgId || !hasSource}
              onClick={() => void runBugbot({ mode: bugbotMode, phase: "fix", scanRepo: false })}
            >
              {bugbotMode === "ultra" ? `Propose fix · $${BUGBOT_ULTRA_PRICES_USD.fix.toFixed(2)}` : "Propose fix"}
            </button>
            <button
              type="button"
              className="app-button secondary"
              disabled={busy || !orgId || !hasSource}
              onClick={() => void runBugbot({ mode: bugbotMode, phase: "recheck", scanRepo: false })}
            >
              {bugbotMode === "ultra" ? `Recheck · $${BUGBOT_ULTRA_PRICES_USD.recheck.toFixed(2)}` : "Recheck"}
            </button>
          </footer>

          {bugbotMeta?.proposedDiff ? (
            <div className="cdc-proposal">
              <span>Proposed fix · human approval required</span>
              <strong>Never pushed to GitHub · never deployed</strong>
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
                    </tr>
                  </thead>
                  <tbody>
                    {bugbot.findings.map((item, index) => (
                      <tr key={`${item.location}-${index}`}>
                        <td>
                          <span className={`cdc-severity ${item.severity}`}>{item.severity}</span>
                          <small className="app-muted">{item.source === "model" ? "model" : "local"}</small>
                        </td>
                        <td>
                          <code>{item.location}</code>
                        </td>
                        <td>
                          <p style={{ margin: 0 }}>{item.finding}</p>
                          <code>{item.evidence}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
          {history.length ? (
            <ol className="cdc-bugbot-history" aria-label="Recent Bugbot runs">
              {history.slice(0, 6).map((row) => (
                <li key={row.id}>
                  <strong>{row.path}</strong>
                  <span>
                    {row.tier ?? "subscription"} · {row.phase ?? "scan"} · {row.riskLevel} · {row.localRiskCount} local ·{" "}
                    {row.modelFindingCount} model
                    {row.chargeUsd && Number(row.chargeUsd) > 0 ? ` · $${Number(row.chargeUsd).toFixed(2)}` : ""}
                    {row.model ? ` · ${row.model}` : ""}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
        </article>
      </section>
    </main>
  );
}
