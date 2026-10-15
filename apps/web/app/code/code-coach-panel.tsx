"use client";

import { EmptyState, Button } from "../../components/ui";
import { WhyPanel } from "../../components/why-panel";
import { CODE_RULE_LESSONS } from "../../lib/agent-narration/narration";
import { CODE_COACH_SAMPLE } from "../../lib/code/code-related";
import { looksLikeJava } from "../../lib/code/looks-like-java";
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
                <h2>Your code</h2>
              </div>
            </header>
            {!hasSource ? (
              <EmptyState
                compact
                title="Paste a robot-code file"
                description="Or try the teaching sample to see what a review finds."
              >
                <Button variant="primary" type="button" onClick={() => { setContent(CODE_COACH_SAMPLE); setReview(null); setProposal(null); setMessage(null); }}>
                  Use the teaching sample
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
              {/* One main action. Scanning this file with Bugbot is on Repo scan ("Scan this
                  file"), and the sample loads from the empty state above. */}
              <Button variant={hasSource ? "primary" : "secondary"} type="button" disabled={busy || !hasSource} onClick={runReview}>
                Run risk review
              </Button>
              <Button variant="secondary" type="button" disabled={busy || !hasSource} onClick={runPropose}>
                Suggest a safer version
              </Button>
            </footer>
          </article>
        </div>

        <div className="cdc-side">
          <article className="cdc-panel">
            <header>
              <div>
                <h2>Findings</h2>
              </div>
              {review ? (
                <span className={`app-badge ${review.riskLevel === "high" ? "danger" : ""}`}>
                  {review.riskLevel === "high" ? "High risk" : review.riskLevel === "medium" ? "Medium risk" : review.riskLevel === "low" ? "Low risk" : `${review.risks.length} found`}
                </span>
              ) : null}
            </header>

            {review ? (
              review.risks.length === 0 && !looksLikeJava(content) ? (
                <EmptyState
                  soft
                  badge="Check the paste"
                  badgeTone="setup"
                  title="This doesn't look like Java"
                  description="The coach reads Java robot code, so nothing it checks was in what you pasted. Paste a .java file, or load the teaching sample, and run the review again."
                />
              ) : review.risks.length === 0 ? (
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
                compact
                title="No review yet"
                description="Run a review to see findings here. Nothing is ever pushed to a robot."
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
                <h2>Before it goes on the robot</h2>
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
              <span>Suggested change</span>
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
