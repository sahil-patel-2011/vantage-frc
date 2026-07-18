"use client";

import { useState } from "react";
import { buildDiffProposal, reviewFrcCode } from "@vantage/agent/coding-assistant";

const SAMPLE = `public void periodic() {
  Timer.delay(0.02);
  driveMotor.set(3);
}`;

/** Teach-not-do lessons keyed by coding-assistant pattern ids. */
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
};

type Review = ReturnType<typeof reviewFrcCode>;
type Proposal = ReturnType<typeof buildDiffProposal>;

export function CodeClient({ orgId = "" }: { orgId?: string }) {
  const [path, setPath] = useState("src/main/java/frc/robot/subsystems/DriveSubsystem.java");
  const [content, setContent] = useState(SAMPLE);
  const [review, setReview] = useState<Review | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const q = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";

  function runReview() {
    setBusy(true);
    setMessage(null);
    setProposal(null);
    try {
      const next = reviewFrcCode({ path, content });
      setReview(next);
      setMessage(
        next.risks.length
          ? `Flagged ${next.risks.length} pattern${next.risks.length === 1 ? "" : "s"} — read the teaching notes before changing code.`
          : "Review complete — no local risk patterns matched.",
      );
      void fetch("/api/code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "review", path, content }),
      }).catch(() => undefined);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Review failed");
    } finally {
      setBusy(false);
    }
  }

  function runPropose() {
    setBusy(true);
    setMessage(null);
    try {
      const nextReview = reviewFrcCode({ path, content });
      const unifiedDiff = [
        `--- a/${path}`,
        `+++ b/${path}`,
        "@@ -1,4 +1,4 @@",
        " public void periodic() {",
        "-  Timer.delay(0.02);",
        "-  driveMotor.set(3);",
        "+  driveMotor.set(MathUtil.clamp(demand, -1.0, 1.0));",
        " }",
      ].join("\n");
      const nextProposal = buildDiffProposal({
        path,
        summary: "Clamp motor output and remove blocking sleep",
        unifiedDiff,
        review: nextReview,
      });
      setReview(nextReview);
      setProposal(nextProposal);
      setMessage("Proposal created — human approval required. Vantage does not deploy to a robot.");
      void fetch("/api/code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "propose",
          path,
          content,
          summary: nextProposal.title,
          unifiedDiff,
        }),
      }).catch(() => undefined);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Proposal failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="module-page cdc-page">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">Build / Code Coach</span>
          <h1>FRC Code Coach</h1>
          <p>
            Flag risky robot-code patterns, explain why they fail under match pressure, then suggest a safer habit.
            Proposed changes stay human-approved unified diffs. It does not write your whole robot for you — and never
            deploys to a robot.
          </p>
        </div>
        <div className="cdc-header-actions">
          <span className="app-badge good">Coach · proposal-only</span>
          {orgId ? (
            <a className="app-button secondary" href={`/editor/pair${q}`}>
              Pair VS Code
            </a>
          ) : null}
        </div>
      </header>

      {orgId ? (
        <nav className="cdc-gov" aria-label="AI governance">
          <a href={`/chat${q}`}>Assistant</a>
          <a href={`/team/budgets${q}#prompt-caching`}>Prompt caching</a>
          <a href={`/team/usage${q}`}>AI usage</a>
          <a href={`/team${q}#github-connection`}>GitHub context</a>
          <a href={`/cad${q}`}>CAD Builder</a>
        </nav>
      ) : null}

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
        <div className="cdc-source">
          <article className="cdc-panel">
            <header>
              <div>
                <span className="app-badge">Repository input</span>
                <h2>Paste / edit source</h2>
              </div>
            </header>
            <label>
              Path
              <input value={path} onChange={(event) => setPath(event.target.value)} />
            </label>
            <label>
              Source
              <textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                rows={14}
                aria-label="Source code"
              />
            </label>
            <footer className="cdc-actions">
              <button type="button" className="primary-action" disabled={busy} onClick={runReview}>
                Run risk review
              </button>
              <button type="button" className="app-button secondary" disabled={busy} onClick={runPropose}>
                Build proposal (diff)
              </button>
              <button
                type="button"
                className="app-button secondary"
                disabled={busy}
                onClick={() => {
                  setContent(SAMPLE);
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
                <div className="soft-empty">
                  <span className="app-badge good">Clear</span>
                  <h2>No risk patterns matched</h2>
                  <p>
                    This pass found nothing in the local coach rules. Still run simulation tests before enabling on a
                    robot.
                  </p>
                </div>
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
              <div className="soft-empty">
                <span className="app-badge setup">Idle</span>
                <h2>No review yet</h2>
                <p>
                  Paste robot code or use the sample, then run a review. AI assistance is a coach — not engineering
                  certification. Vantage never deploys to a robot.
                </p>
              </div>
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
                No autonomous robot deploy. Mentors or students approve every diff.
              </p>
              {proposal ? <pre aria-label="Unified diff proposal">{proposal.unifiedDiff}</pre> : null}
            </div>
          </article>
        </div>
      </section>
    </main>
  );
}
