"use client";

import { useState } from "react";
import { buildDiffProposal, reviewFrcCode } from "@vantage/agent/coding-assistant";

const SAMPLE = `public void periodic() {
  Timer.delay(0.02);
  driveMotor.set(3);
}`;

type Review = ReturnType<typeof reviewFrcCode>;
type Proposal = ReturnType<typeof buildDiffProposal>;

export function CodeClient() {
  const [path, setPath] = useState("src/main/java/frc/robot/subsystems/DriveSubsystem.java");
  const [content, setContent] = useState(SAMPLE);
  const [review, setReview] = useState<Review | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function runReview() {
    setBusy(true);
    setMessage(null);
    setProposal(null);
    try {
      const next = reviewFrcCode({ path, content });
      setReview(next);
      setMessage("Review complete.");
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
      setMessage("Proposal created (approval required).");
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
    <main className="module-page">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">Build / Code</span>
          <h1>FRC Code Builder / Debugger</h1>
          <p>
            Robot-specific risk review and human-approved proposal artifacts. Vantage does not deploy code to a
            robot.
          </p>
        </div>
        <span className="app-badge">Fixture / local analysis</span>
      </header>
      {message ? (
        <p role="status" className="telemetry-status">
          {message}
        </p>
      ) : null}
      <section className="code-workbench">
        <article className="app-card code-source">
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
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={12}
            aria-label="Source code"
          />
          <footer className="intel-actions">
            <button type="button" disabled={busy} onClick={runReview}>
              Run risk review
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={runPropose}>
              Build proposal (diff)
            </button>
            <button
              type="button"
              className="secondary"
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
        <article className="app-card code-findings">
          <header>
            <div>
              <span className={`app-badge ${review?.riskLevel === "high" ? "danger" : ""}`}>
                {review?.riskLevel ?? "idle"} risk
              </span>
              <h2>Review findings</h2>
            </div>
            <strong>{review?.risks.length ?? 0}</strong>
          </header>
          {review ? (
            review.risks.length === 0 ? (
              <div className="soft-empty">
                <span className="app-badge good">Clear</span>
                <h2>No risk patterns matched</h2>
                <p>This pass found nothing in the local fixture rules. Still run simulation tests before enabling on a robot.</p>
              </div>
            ) : (
              <ul>
                {review.risks.map((risk) => (
                  <li key={risk.pattern}>
                    <div>
                      <span className={`severity ${risk.severity}`}>{risk.severity}</span>
                      <b>{risk.pattern.replaceAll("-", " ")}</b>
                    </div>
                    <p>{risk.message}</p>
                    <code>{risk.evidence}</code>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <div className="soft-empty">
              <span className="app-badge setup">Idle</span>
              <h2>No review yet</h2>
              <p>Run a review against pasted robot code or the sample fixture. Vantage never deploys to a robot.</p>
            </div>
          )}
        </article>
        <article className="app-card code-checks">
          <header>
            <h2>Required checks</h2>
            <span className="app-badge good">Policy</span>
          </header>
          <ol>
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
          <div className="proposal-state">
            <span>OUTPUT STATE</span>
            <strong>
              {proposal
                ? `${proposal.executionState} · human approval required`
                : "Proposal only · human approval required"}
            </strong>
          </div>
          {proposal ? <pre aria-label="Unified diff proposal">{proposal.unifiedDiff}</pre> : null}
        </article>
      </section>
    </main>
  );
}
