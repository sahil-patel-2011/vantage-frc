"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState } from "../../components/ui";
import {
  canUseDeepGameAnalysis,
  deepAnalysisElapsedCopy,
  deepAnalysisStatusCopy,
  type DeepAnalysisRunView,
} from "../../lib/kickoff/deep-analysis";

export function DeepGameAnalysisPanel({
  orgId,
  seasonYear,
  teamNumber,
  role,
}: {
  orgId: string;
  seasonYear: number;
  teamNumber: number | null;
  role: string | null;
}) {
  const allowed = canUseDeepGameAnalysis(teamNumber);
  const [view, setView] = useState<DeepAnalysisRunView | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [model, setModel] = useState("deepseek/deepseek-v4-flash");
  const canStart = role === "owner" || role === "admin";

  const load = useCallback(async () => {
    if (!allowed || !orgId) return;
    try {
      const response = await fetch(
        `/api/kickoff/deep-analysis?orgId=${encodeURIComponent(orgId)}&seasonYear=${seasonYear}`,
      );
      const data = (await response.json()) as DeepAnalysisRunView & { error?: string };
      if (!response.ok) {
        setMessage(data.error ?? "Could not load deep analysis.");
        return;
      }
      setView(data);
      if (!data.run && data.models?.[0]?.slug) setModel(data.models[0].slug);
      setMessage("");
    } catch {
      setMessage("Could not reach deep analysis.");
    }
  }, [allowed, orgId, seasonYear]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!view?.run || (view.run.status !== "running" && view.run.status !== "queued")) return;
    const timer = window.setInterval(() => {
      void load();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [load, view?.run?.status]);

  async function act(action: "start" | "cancel") {
    setBusy(true);
    try {
      const response = await fetch("/api/kickoff/deep-analysis", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, orgId, seasonYear, model }),
      });
      const data = (await response.json()) as DeepAnalysisRunView & { error?: string };
      if (!response.ok) {
        setMessage(data.error ?? "Update failed.");
        return;
      }
      setView(data);
      setMessage(
        action === "start"
          ? "Queued on the Pi. It will think continuously for five hours — not hourly loops."
          : "Run cancelled.",
      );
    } catch {
      setMessage("Network error — the run was not changed.");
    } finally {
      setBusy(false);
    }
  }

  if (!allowed) return null;

  const run = view?.run ?? null;
  const guess = run?.latestGuess ?? null;
  const active = run?.status === "queued" || run?.status === "running";
  const models = view?.models?.length
    ? view.models
    : [
        {
          id: "deepseek-v4-flash",
          slug: "deepseek/deepseek-v4-flash",
          label: "DeepSeek V4 Flash",
          metered: false,
          note: "Free, unlimited, and fast request routing.",
        },
        { id: "glm-5.3-flash", slug: "glm/glm-5.3-flash", label: "GLM 5.3 Flash", metered: false, note: "Free and unmetered." },
        { id: "mimo-2.5", slug: "mimo/mimo-2.5", label: "MiMo 2.5", metered: false, note: "Free and unmetered." },
      ];

  return (
    <section className="app-card soft-panel kick-section kick-deep" aria-label="Deep game analysis">
      <header>
        <h2>Deep game analysis (Team 6925)</h2>
        <p className="app-muted">
          One continuous 5-hour think on the Pi through Freebuff Coder UI: keep fetching teasers, theme
          posts, past official games, and community speculation. Not an hourly schedule. Guesses stay
          empty without fetched evidence — this is never the official manual.
        </p>
      </header>

      {message ? <p className="telemetry-status">{message}</p> : null}
      {view?.reason ? <p className="app-muted">{view.reason}</p> : null}

      <p className="app-muted" role="status">
        {deepAnalysisStatusCopy(run?.status)}{" "}
        {run
          ? `${deepAnalysisElapsedCopy(run.startedAt, run.minHours)} · ${run.loopCount} contemplation passes${run.model ? ` · ${run.model}` : ""}.`
          : deepAnalysisElapsedCopy(null, 5)}
      </p>

      <label className="ai-funding-model">
        Model for this run
        <select
          value={run?.model ?? model}
          disabled={busy || !canStart || active}
          onChange={(event) => setModel(event.target.value)}
        >
          {models.map((option) => (
            <option key={option.slug} value={option.slug}>
              {option.label}
              {option.metered ? " (metered)" : ""}
            </option>
          ))}
        </select>
      </label>
      {models.find((option) => option.slug === (run?.model ?? model))?.note ? (
        <p className="app-muted">
          {models.find((option) => option.slug === (run?.model ?? model))?.note}
        </p>
      ) : null}

      <div className="intel-actions">
        <button
          type="button"
          className="app-button"
          disabled={busy || !canStart || active}
          onClick={() => void act("start")}
        >
          {busy ? "Working…" : "Start 5-hour analysis"}
        </button>
        <button
          type="button"
          className="app-button secondary"
          disabled={busy || !canStart || !active}
          onClick={() => void act("cancel")}
        >
          Stop
        </button>
      </div>

      {!canStart ? (
        <p className="app-muted">Owner or admin starts the Pi job. Everyone on 6925 can watch progress.</p>
      ) : null}

      {guess ? (
        <div className="kick-deep-guess">
          <h3>Best current guess</h3>
          <p>
            Confidence: <strong>{guess.confidence}</strong>
          </p>
          <p className="app-muted">{guess.disclaimer}</p>
          <dl>
            <div>
              <dt>Theme</dt>
              <dd>{guess.themeGuess ?? "—"}</dd>
            </div>
            <div>
              <dt>Field</dt>
              <dd>{guess.fieldGuess ?? "—"}</dd>
            </div>
          </dl>
          {guess.scoringGuess.length ? (
            <ul>
              {guess.scoringGuess.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            <EmptyState soft title="No scoring guess yet" description="Waiting on fetched teaser or official text." />
          )}
          {guess.rulesGuess.length ? (
            <>
              <h4>Rules guess</h4>
              <ul>
                {guess.rulesGuess.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          ) : null}
          {guess.speculation.length ? (
            <>
              <h4>Labeled speculation</h4>
              <ul>
                {guess.speculation.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          ) : null}
          {guess.unknowns.length ? (
            <>
              <h4>Unknowns</h4>
              <ul>
                {guess.unknowns.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : (
        <EmptyState
          soft
          title="No guess stored"
          description="Start a run and leave Coder UI signed in on the Pi. The first passes gather sources before any guess is written."
        />
      )}

      {view?.loops.length ? (
        <ol className="kick-deep-loops">
          {view.loops.map((loop) => (
            <li key={loop.sequence}>
              <strong>
                Pass {loop.sequence}: {loop.focus || "contemplation"}
              </strong>
              <span>
                {loop.status}
                {loop.notes ? ` — ${loop.notes}` : ""}
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      {view?.sources.length ? (
        <ul className="kick-deep-sources">
          {view.sources.map((source) => (
            <li key={source.url}>
              <a href={source.url} target="_blank" rel="noreferrer">
                {source.title || source.url}
              </a>
              <span>
                {source.kind}
                {source.fetchOk ? " · fetched" : " · not fetched"}
                {source.error ? ` · ${source.error}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
