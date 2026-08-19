"use client";

import { useEffect, useState } from "react";
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
};

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
  const [bugbotMeta, setBugbotMeta] = useState<{ provider?: string; model?: string } | null>(null);
  const [history, setHistory] = useState<BugbotHistoryRow[]>([]);
  const [cutoffCode, setCutoffCode] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const hasSource = Boolean(content.trim());
  const showMeteredBanner = Boolean(orgId) && related === "ai";
  const relatedLinks = codeCoachRelatedLinks(orgId || null, { include: [...CODE_COACH_RELATED_INCLUDE] });
  const nextActions = codeCoachNextActions({
    orgId: orgId || null,
    hasSource,
    hasReview: Boolean(review),
  });
  const chatHref = orgId ? hubHref("/ai", "chat", orgId) : "/ai?tab=chat";
  const cadHref = orgId ? hubHref("/build", "cad", orgId) : "/build?tab=cad";
  const budgetsHref = orgId ? hubHref("/ai", "budgets", orgId) : "/ai?tab=budgets";
  const keysHref = orgId ? withOrgHref("/team/ai-keys", orgId) : "/team/ai-keys";

  useEffect(() => {
    if (!orgId) return;
    void fetch(`/api/code?orgId=${encodeURIComponent(orgId)}`)
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as { reviews?: BugbotHistoryRow[] };
        setHistory(data.reviews ?? []);
      })
      .catch(() => undefined);
  }, [orgId]);

  async function runBugbot() {
    if (!content.trim()) {
      setMessage("Paste robot source before running AI Bugbot.");
      return;
    }
    if (!orgId) {
      setMessage("Choose a workspace before the metered Bugbot pass.");
      return;
    }
    setBusy(true);
    setCutoffCode(null);
    setMessage(null);
    try {
      const response = await fetch("/api/code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "bugbot", path, content, orgId }),
      });
      const data = (await response.json()) as {
        error?: string;
        code?: string;
        reason?: string;
        hardCutoff?: boolean;
        review?: BugbotReview;
        provider?: string;
        model?: string;
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
        setBugbotMeta({ provider: data.provider, model: data.model });
        setMessage(
          data.review.findings.length
            ? `Bugbot: ${data.review.findings.length} grounded finding${data.review.findings.length === 1 ? "" : "s"} (${data.review.localRiskCount} local · ${data.review.modelFindingCount} model). Ungrounded model claims dropped: ${data.review.droppedUngrounded}. Never deploys.`
            : "Bugbot complete — no grounded findings in this source.",
        );
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
          <span className="app-badge">Metered AI</span>
          <h2>AI Bugbot</h2>
          <p>
            A second pass uses your plan allowance / credits. Findings must quote a substring from this file — invented
            issues are dropped. Distinct from CAD briefs and chat.
          </p>
          <div className="cdc-billing-actions">
            <a className="app-button secondary" href="#bugbot">
              AI Bugbot
            </a>
            <a className="app-button secondary" href={chatHref}>
              AI chat
            </a>
            <a className="app-button secondary" href={cadHref}>
              Build · CAD
            </a>
            <a className="app-button secondary" href={keysHref}>
              AI API keys
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
              <span className="app-badge">Metered AI</span>
              <h2>AI Bugbot</h2>
              <p className="app-muted" style={{ margin: "4px 0 0" }}>
                Quotes evidence from this file only. Local rules stay even if the model is quiet. Never deploys.
                {bugbotMeta?.model ? ` · ${bugbotMeta.provider}/${bugbotMeta.model}` : ""}
              </p>
            </div>
            <button type="button" className="primary-action" disabled={busy || !hasSource || !orgId} onClick={() => void runBugbot()}>
              Run AI Bugbot
            </button>
          </header>
          {!orgId ? (
            <EmptyState
              soft
              badge="Setup required"
              badgeTone="setup"
              title="Choose a workspace for Bugbot"
              description="Local pattern review is free. The metered Bugbot pass needs a team and an AI provider key."
            >
              <a className="app-button" href="/workspace">
                Choose workspace
              </a>
            </EmptyState>
          ) : bugbot ? (
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
                    did not quote this file.
                  </p>
                ) : null}
              </div>
            )
          ) : (
            <EmptyState
              soft
              badge="Idle"
              badgeTone="setup"
              title="No Bugbot pass yet"
              description="Paste source, then run AI Bugbot. Needs an AI provider key under Team → AI API keys. Findings stay empty until evidence is in the file."
            >
              <a className="app-button secondary" href={keysHref}>
                AI API keys
              </a>
            </EmptyState>
          )}
          {history.length ? (
            <ol className="cdc-bugbot-history" aria-label="Recent Bugbot runs">
              {history.slice(0, 6).map((row) => (
                <li key={row.id}>
                  <strong>{row.path}</strong>
                  <span>
                    {row.riskLevel} · {row.localRiskCount} local · {row.modelFindingCount} model
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
