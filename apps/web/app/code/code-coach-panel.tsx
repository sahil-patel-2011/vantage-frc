"use client";

import { EmptyState, Button } from "../../components/ui";
import { WhyPanel } from "../../components/why-panel";
import { CODE_RULE_LESSONS } from "../../lib/agent-narration/narration";
import { CODE_COACH_SAMPLE } from "../../lib/code/code-related";
import type { CodeReadyViewProps } from "./code-view-props";

/** Teach-not-do lessons live in the shared narration catalog so the WhyPanel and this list agree. */
const COACH_LESSONS = CODE_RULE_LESSONS;

export type CodeCoachPanelProps = Pick<
  CodeReadyViewProps,
  | "orgId"
  | "hasSource"
  | "path"
  | "setPath"
  | "content"
  | "setContent"
  | "setReview"
  | "setProposal"
  | "setMessage"
  | "busy"
  | "runReview"
  | "runPropose"
  | "runBugbot"
  | "review"
  | "proposal"
  | "coachNarrations"
>;

export function CodeCoachPanel({
  orgId,
  hasSource,
  path,
  setPath,
  content,
  setContent,
  setReview,
  setProposal,
  setMessage,
  busy,
  runReview,
  runPropose,
  runBugbot,
  review,
  proposal,
  coachNarrations,
}: CodeCoachPanelProps) {
  return (
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
                <Button variant="primary" type="button" onClick={() => { setContent(CODE_COACH_SAMPLE); setReview(null); setProposal(null); setMessage(null); }}>
                  Load teaching sample
                </Button>
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
              <Button variant="primary" type="button" disabled={busy || !hasSource} onClick={runReview}>
                Run risk review
              </Button>
              <Button variant="secondary" type="button" disabled={busy || !hasSource} onClick={runPropose}>
                Build proposal (diff)
              </Button>
              <Button variant="secondary" type="button" disabled={busy || !hasSource || !orgId} onClick={() => void runBugbot()}>
                Run AI Bugbot
              </Button>
              <Button variant="secondary" type="button" disabled={busy} onClick={() => { setContent(CODE_COACH_SAMPLE); setReview(null); setProposal(null); setMessage(null); }}>
                Reset sample
              </Button>
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
                description="Paste robot code or load the sample, then run a review. Nothing is ever pushed to a robot."
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
                A mentor or student approves every diff before it goes anywhere. Nothing deploys on its own.
              </p>
              {proposal ? <pre aria-label="Unified diff proposal">{proposal.unifiedDiff}</pre> : null}
            </div>
          </article>
        </div>
      </section>
  );
}
