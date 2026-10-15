"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui";
import { anySignal } from "../../lib/abort/any-signal";
import { friendlyErrorMessage } from "../../lib/ui/friendly-error";
import type { MatchBrief } from "../../lib/match-brief/types";
import type { MatchBriefResult } from "../../lib/match-brief/generate";

/** Other people's new briefs reach this page within a minute. */
const REFRESH_MS = 60_000;

function when(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

function matchName(matchKey: string | null) {
  if (!matchKey) return null;
  const tail = matchKey.split("_")[1] ?? "";
  const qm = tail.match(/^qm(\d+)$/);
  return qm ? `Qual ${qm[1]}` : tail.toUpperCase();
}

/**
 * The pre-match plan for this match, written for the drive team: the odds, how to raise them,
 * what each opponent will most likely do and how, each partner's job, and the three phases.
 * Opening the page writes a fresh one when the stored plan is out of date (when this person has
 * automatic briefs on); "Write a new plan" writes one now. Everyone on the team sees the newest.
 */
export function MatchBriefCard({ orgId, matchKey, onShown }: { orgId: string; matchKey: string; onShown?: (shown: boolean) => void }) {
  const [brief, setBrief] = useState<MatchBrief | null>(null);
  const [stale, setStale] = useState(false);
  const [state, setState] = useState<"loading" | "idle" | "writing">("loading");
  const [problem, setProblem] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  /** The request in flight; a background re-read never cancels a plan being written. */
  const inFlight = useRef<"ensure" | "read" | "regenerate" | null>(null);

  const fetchBrief = useCallback(
    async (mode: "ensure" | "read" | "regenerate") => {
      // A plan can take over a minute on a local model. The minute's background re-read waits for
      // it instead of aborting it (which hid the "Writing…" state and invited a second, paid write).
      if (mode === "read" && inFlight.current && inFlight.current !== "read") return;
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      inFlight.current = mode;
      if (mode !== "read") setState(mode === "regenerate" ? "writing" : "loading");
      try {
        const response =
          mode === "regenerate"
            ? await fetch("/api/match-brief", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ orgId, matchKey, action: "regenerate" }),
                signal: anySignal([controller.signal, AbortSignal.timeout(130_000)]),
              })
            : await fetch(`/api/match-brief?${new URLSearchParams({ orgId, matchKey, mode })}`, {
                cache: "no-store",
                signal: anySignal([controller.signal, AbortSignal.timeout(130_000)]),
              });
        const data = (await response.json().catch(() => ({}))) as MatchBriefResult & { error?: string };
        if (controller.signal.aborted) return;
        if (!response.ok) {
          // A background refresh that fails keeps the plan on screen and says nothing.
          if (mode !== "read") setProblem(data.error ?? "The plan couldn't be written right now.");
          return;
        }
        setProblem(null);
        if (data.status === "ready") {
          setBrief(data.brief);
          setStale(data.stale);
        } else if (mode !== "read") {
          setBrief(null);
        }
      } catch (error) {
        if (!controller.signal.aborted && mode !== "read") setProblem(friendlyErrorMessage(error, "The plan couldn't be written right now."));
      } finally {
        if (request.current === controller) inFlight.current = null;
        if (!controller.signal.aborted) setState("idle");
      }
    },
    [orgId, matchKey],
  );

  useEffect(() => {
    setBrief(null);
    void fetchBrief("ensure");
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void fetchBrief("read");
    }, REFRESH_MS);
    return () => {
      window.clearInterval(timer);
      request.current?.abort();
    };
  }, [fetchBrief]);

  useEffect(() => {
    onShown?.(Boolean(brief));
  }, [brief, onShown]);

  if (state === "loading" && !brief) {
    return (
      <section className="app-card brief-plan" aria-busy="true">
        <h2>Match plan</h2>
        <p className="app-muted" role="status">Getting the plan for this match…</p>
      </section>
    );
  }

  if (!brief) {
    return (
      <section className="app-card brief-plan">
        <h2>Match plan</h2>
        <p className="app-muted">No plan for this match yet. It&apos;s written from the prediction, scouting and each team&apos;s history.</p>
        {problem ? <p className="brief-plan-problem" role="alert">{problem}</p> : null}
        <div className="brief-plan-actions">
          <Button variant="primary" type="button" disabled={state === "writing"} onClick={() => void fetchBrief("regenerate")}>
            {state === "writing" ? "Writing the plan…" : "Write the plan"}
          </Button>
        </div>
      </section>
    );
  }

  const throughMatch = matchName(brief.source.lastPlayedMatch);
  return (
    <section className="app-card brief-plan" aria-labelledby="brief-plan-title">
      <header className="brief-plan-head">
        <h2 id="brief-plan-title">Match plan</h2>
        <span className="brief-plan-odds">{brief.winChance}% to win</span>
      </header>
      <p className="brief-plan-headline">{brief.headline}</p>

      <h3>How to raise our odds</h3>
      <ol className="brief-plan-moves">
        {brief.raiseOdds.map((move) => (
          <li key={move.action}>
            <b>{move.action}</b>
            {move.gain != null && move.gain > 0 ? <span className="brief-plan-gain">+{move.gain}% win chance</span> : null}
            <p>{move.why}</p>
          </li>
        ))}
      </ol>

      {brief.opponents.length ? (
        <>
          <h3>What they&apos;ll most likely do</h3>
          <ul className="brief-plan-opponents">
            {brief.opponents.map((row) => (
              <li key={row.team}>
                <b>Team {row.team}</b>
                <p>{row.likely}</p>
                {row.how ? <p className="app-muted">{row.how}</p> : null}
                <p className="brief-plan-counter">Our answer: {row.counter}</p>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {brief.partners.length ? (
        <>
          <h3>Jobs on our alliance</h3>
          <ul className="brief-plan-partners">
            {brief.partners.map((row) => (
              <li key={row.team}>
                <b>Team {row.team}:</b> {row.role}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {brief.phases.auto || brief.phases.teleop || brief.phases.endgame ? (
        <dl className="brief-plan-phases">
          {brief.phases.auto ? (<><dt>Auto</dt><dd>{brief.phases.auto}</dd></>) : null}
          {brief.phases.teleop ? (<><dt>Teleop</dt><dd>{brief.phases.teleop}</dd></>) : null}
          {brief.phases.endgame ? (<><dt>Endgame</dt><dd>{brief.phases.endgame}</dd></>) : null}
        </dl>
      ) : null}

      {brief.watchFor.length ? (
        <>
          <h3>Watch for</h3>
          <ul className="brief-plan-watch">
            {brief.watchFor.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      ) : null}

      <footer className="brief-plan-foot">
        <p className="app-muted">
          Written {when(brief.source.generatedAt)}
          {brief.source.generatedByName ? ` by ${brief.source.generatedByName}` : ""}
          {brief.source.trigger === "auto" ? " (automatically)" : ""}
          {throughMatch ? ` · uses results through ${throughMatch}` : ""}
          {` · ${brief.source.scoutReports} scout reports`}
          {brief.source.writer === "local" ? " · written by Vantage from the numbers (no AI connected)" : ""}
        </p>
        {stale ? <p className="brief-plan-stale" role="status">Newer matches or scouting are in since this was written.</p> : null}
        {problem ? <p className="brief-plan-problem" role="alert">{problem}</p> : null}
        <Button variant={stale ? "primary" : "secondary"} size="sm" type="button" disabled={state === "writing"} onClick={() => void fetchBrief("regenerate")}>
          {state === "writing" ? "Writing a new plan…" : "Write a new plan"}
        </Button>
      </footer>
    </section>
  );
}
