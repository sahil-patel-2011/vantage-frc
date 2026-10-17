"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui";
import { notifyTeamDataChanged } from "../../../lib/team-data-changed";
import { friendlyErrorMessage } from "../../../lib/ui/friendly-error";

/** Writing the match plan reads every scouting report and asks the model; give it the full five minutes. */
export const PREDICT_TIMEOUT_MS = 5 * 60_000;

type Phase = { kind: "idle" } | { kind: "running"; startedAt: number } | { kind: "done"; winChance: number | null; headline: string | null } | { kind: "failed"; message: string };

function elapsedLabel(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * "Predict this match": re-scores the match from the latest data (win chance and score), saves it
 * for the whole team, and writes the match plan (/api/match-brief, which runs the strategy model
 * and stores the prediction). It can take up to five minutes, so it says so and counts up; when it
 * finishes, Home and every other open tab on the team refresh.
 */
export function PredictMatchButton({ orgId, matchKey, planHref }: { orgId: string; matchKey: string; planHref: string | null }) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [now, setNow] = useState(() => Date.now());
  const running = phase.kind === "running";
  const mounted = useRef(true);

  useEffect(() => () => {
    mounted.current = false;
  }, []);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  const predict = async () => {
    const startedAt = Date.now();
    setNow(startedAt);
    setPhase({ kind: "running", startedAt });
    try {
      const response = await fetch("/api/match-brief", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "regenerate", orgId, matchKey }),
        signal: AbortSignal.timeout(PREDICT_TIMEOUT_MS),
      });
      const data = (await response.json().catch(() => null)) as
        | { status: "ready"; brief: { winChance?: number; headline?: string } }
        | { status: "empty" | "setup_required"; message?: string }
        | { error?: string }
        | null;
      if (!mounted.current) return;
      if (response.ok && data && "status" in data && data.status === "ready") {
        const win = Number(data.brief.winChance);
        setPhase({ kind: "done", winChance: Number.isFinite(win) ? Math.round(win) : null, headline: data.brief.headline ?? null });
        notifyTeamDataChanged({ orgId, kind: "event" });
        return;
      }
      const message =
        (data && "message" in data && data.message) ||
        (data && "error" in data && data.error) ||
        "The prediction didn't finish. Try again in a minute.";
      setPhase({ kind: "failed", message });
    } catch (error) {
      if (!mounted.current) return;
      setPhase({ kind: "failed", message: friendlyErrorMessage(error, "The prediction didn't finish. Try again in a minute.") });
    }
  };

  if (phase.kind === "running") {
    return (
      <div className="nm-predict" role="status" aria-live="polite">
        <span className="nm-predict-spinner" aria-hidden="true" />
        <span>
          Predicting the score… {elapsedLabel(now - phase.startedAt)}
          <small>Can take up to 5 minutes. You can keep using Vantage; it updates for the whole team.</small>
        </span>
      </div>
    );
  }
  if (phase.kind === "done") {
    return (
      <div className="nm-predict is-done" role="status">
        <span>
          {phase.winChance != null ? `Prediction ready · ${phase.winChance}% chance we win` : "Prediction ready"}
          {phase.headline ? <small>{phase.headline}</small> : null}
        </span>
        {planHref ? <a href={planHref}>Match plan</a> : null}
      </div>
    );
  }
  return (
    <div className="nm-predict">
      {phase.kind === "failed" ? (
        <p className="telemetry-status" role="alert">
          {phase.message}
        </p>
      ) : null}
      <Button variant="secondary" size="sm" onClick={() => void predict()}>
        {phase.kind === "failed" ? "Try again" : "Predict this match"}
      </Button>
      <small className="app-muted">Win chance and score from the latest data · up to 5 minutes</small>
    </div>
  );
}
