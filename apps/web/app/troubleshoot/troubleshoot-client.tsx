"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { EmptyState, ModelProvenance, PageHeader, Panel } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import type {
  PriorSession,
  TroubleshootSessionView,
  TroubleshootView,
} from "../../lib/troubleshoot/compute-troubleshoot";
import type { TroubleshootAnswer, TroubleshootCheck } from "../../lib/troubleshoot/symptom-tree";

type LiveView = Extract<TroubleshootView, { status: "live" }>;

/** >=44px targets everywhere: this page gets used on a phone, in a pit, under stress. */
const TAP: CSSProperties = { minHeight: 44, padding: "10px 14px" };

function whenLabel(iso: string | null): string {
  if (!iso) return "";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString();
}

export default function TroubleshootClient() {
  const [view, setView] = useState<TroubleshootView | null>(null);
  const [session, setSession] = useState<TroubleshootSessionView | null>(null);
  const [answers, setAnswers] = useState<TroubleshootAnswer[]>([]);
  const [text, setText] = useState("");
  const [resolution, setResolution] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [loadErrorMessage, setLoadErrorMessage] = useState("");
  const [closed, setClosed] = useState<"resolved" | "stuck" | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(() => {
    setFetchFailed(false);
    setError("");
    setErrorStatus(null);
    setLoadErrorMessage("");
    const urlOrg = new URLSearchParams(window.location.search).get("orgId");
    void fetch(`/api/troubleshoot${urlOrg ? `?orgId=${encodeURIComponent(urlOrg)}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as TroubleshootView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setLoadErrorMessage("error" in data && data.error ? data.error : "");
          setErrorStatus(response.status);
          setFetchFailed(true);
          return;
        }
        setView(data);
      })
      .catch(() => setFetchFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const post = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return null;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/troubleshoot", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
        });
        const data = (await response.json()) as TroubleshootSessionView | { error?: string };
        if (!response.ok || !("walk" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return null;
        }
        setSession(data);
        return data;
      } catch {
        setError("Network error — the guide below still works offline once loaded.");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy],
  );

  const beginSymptom = useCallback(
    async (symptomId: string) => {
      setAnswers([]);
      setClosed(null);
      setResolution("");
      await post({ action: "start", symptomId, text: text.trim() || undefined });
    },
    [post, text],
  );

  const beginFromText = useCallback(
    async (useAi: boolean) => {
      if (!text.trim()) {
        setError("Describe what is happening, or pick a symptom below.");
        return;
      }
      setAnswers([]);
      setClosed(null);
      setResolution("");
      await post({ action: "triage", text: text.trim(), useAi });
    },
    [post, text],
  );

  const answerCheck = useCallback(
    async (checkId: string, outcomeId: string) => {
      if (!session) return;
      const next = [...answers, { checkId, outcomeId }];
      setAnswers(next);
      const updated = await post({
        action: "answer",
        symptomId: session.symptomId,
        sessionId: session.sessionId,
        answers: next,
      });
      if (!updated) setAnswers(answers);
      else if (updated.walk.handoffSymptomId) {
        // The tree decided this is a different problem. Follow it, honestly labelled.
        setAnswers([]);
        await post({ action: "start", symptomId: updated.walk.handoffSymptomId, text: text.trim() || undefined });
      }
    },
    [answers, post, session, text],
  );

  const close = useCallback(
    async (resolved: boolean) => {
      if (!session) return;
      await post({
        action: "close",
        symptomId: session.symptomId,
        sessionId: session.sessionId,
        answers,
        resolved,
        resolution: resolution.trim() || undefined,
      });
      setClosed(resolved ? "resolved" : "stuck");
    },
    [answers, post, resolution, session],
  );

  const restart = useCallback(() => {
    setSession(null);
    setAnswers([]);
    setClosed(null);
    setResolution("");
    setError("");
    load();
  }, [load]);

  const failure = fetchFailed
    ? loadFailureCopy(
        classifyLoadFailure({
          status: errorStatus,
          message: loadErrorMessage,
          online: typeof navigator === "undefined" ? true : navigator.onLine,
        }),
        {
          nextPath:
            typeof window === "undefined" ? null : `${window.location.pathname}${window.location.search}`,
          message: loadErrorMessage || "A network or server issue prevented loading. Try again.",
        },
      )
    : null;

  const buildHref = orgId ? `/build?tab=code&orgId=${encodeURIComponent(orgId)}` : "/build?tab=code";

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={buildHref}>Build</a>
            {" / Get unstuck"}
          </>
        }
        title="Get unstuck"
        description="Check-by-check troubleshooting for the control-system failures that stop teams. Every step says what it rules out, and every fix cites the doc it came from."
      >
        {session ? (
          <button type="button" className="app-button secondary" style={TAP} onClick={restart}>
            Start over
          </button>
        ) : null}
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {failure ? (
        <EmptyState title={failure.title} description={failure.description}>
          {failure.primary ? (
            <a className="app-button" style={TAP} href={failure.primary.href}>
              {failure.primary.label}
            </a>
          ) : null}
          {failure.showRetry ? (
            <button type="button" className="app-button secondary" style={TAP} onClick={() => load()}>
              Retry
            </button>
          ) : null}
        </EmptyState>
      ) : view == null ? (
        <EmptyState title="Loading…" description="Checking your workspace." aria-busy />
      ) : view.status === "setup_required" ? (
        <EmptyState badge="Setup required" badgeTone="setup" title={view.message}>
          <ol className="strategy-setup-steps">
            {view.steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <a href={step.href}>Open</a>
              </li>
            ))}
          </ol>
        </EmptyState>
      ) : session ? (
        <WalkScreen
          view={view}
          session={session}
          busy={busy}
          closed={closed}
          resolution={resolution}
          setResolution={setResolution}
          onAnswer={answerCheck}
          onClose={close}
          onPickSymptom={beginSymptom}
          orgId={view.orgId}
        />
      ) : (
        <PickScreen
          view={view}
          text={text}
          setText={setText}
          busy={busy}
          onDescribe={beginFromText}
          onPickSymptom={beginSymptom}
        />
      )}
    </main>
  );
}

function PickScreen({
  view,
  text,
  setText,
  busy,
  onDescribe,
  onPickSymptom,
}: {
  view: LiveView;
  text: string;
  setText: (value: string) => void;
  busy: boolean;
  onDescribe: (useAi: boolean) => void;
  onPickSymptom: (symptomId: string) => void;
}) {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Panel>
        <h2 style={{ marginTop: 0 }}>What is happening?</h2>
        <p className="app-muted" style={{ marginTop: 0 }}>
          Describe it in your own words, or skip straight to a symptom below. Both routes run the same
          curated checklist — the description just picks the starting point for you.
        </p>
        <label htmlFor="troubleshoot-text" className="app-muted" style={{ display: "block", marginBottom: 6 }}>
          Describe the problem
        </label>
        <textarea
          id="troubleshoot-text"
          value={text}
          rows={3}
          onChange={(event) => setText(event.target.value)}
          placeholder="e.g. we deployed fine yesterday and now the driver station comms light is red"
          style={{ width: "100%", minHeight: 88, padding: 12 }}
        />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
          <button
            type="button"
            className="app-button"
            style={TAP}
            disabled={busy || !text.trim()}
            onClick={() => onDescribe(true)}
          >
            Find my starting point
          </button>
          <button
            type="button"
            className="app-button secondary"
            style={TAP}
            disabled={busy || !text.trim()}
            onClick={() => onDescribe(false)}
          >
            Match without AI
          </button>
        </div>
      </Panel>

      <Panel>
        <h2 style={{ marginTop: 0 }}>Or pick the symptom</h2>
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
          {view.symptoms.map((symptom) => (
            <li key={symptom.id}>
              <button
                type="button"
                className="app-card soft-panel"
                style={{
                  ...TAP,
                  width: "100%",
                  textAlign: "left",
                  display: "grid",
                  gap: 4,
                  cursor: "pointer",
                  border: "1px solid var(--app-line)",
                  background: "var(--app-surface)",
                  color: "var(--app-ink)",
                }}
                disabled={busy}
                onClick={() => onPickSymptom(symptom.id)}
              >
                <strong>{symptom.label}</strong>
                <span className="app-muted">{symptom.summary}</span>
                <small className="app-muted">
                  {symptom.checkCount} checks · {symptom.fixCount} documented fixes
                </small>
              </button>
            </li>
          ))}
        </ul>
        <p className="app-muted" style={{ marginBottom: 0, marginTop: 12, fontSize: "0.85em" }}>
          {view.docNote}
        </p>
      </Panel>

      {view.recentSessions.length > 0 ? (
        <Panel>
          <h2 style={{ marginTop: 0 }}>Your team&apos;s recent walks</h2>
          <p className="app-muted" style={{ marginTop: 0 }}>
            Written by your own teammates. This is what the next student sees when they hit the same thing.
          </p>
          <SessionList sessions={view.recentSessions} />
        </Panel>
      ) : null}
    </div>
  );
}

function SessionList({ sessions }: { sessions: PriorSession[] }) {
  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
      {sessions.map((entry) => (
        <li
          key={entry.id}
          style={{
            border: "1px solid var(--app-line)",
            borderRadius: "var(--app-radius)",
            padding: 12,
            display: "grid",
            gap: 4,
          }}
        >
          <span>
            <span className={`app-badge ${entry.resolved ? "good" : "setup"}`}>
              {entry.resolved ? "Fixed" : "Open"}
            </span>{" "}
            <strong>{entry.fixTitle ?? `${entry.stepCount} check(s) walked`}</strong>
          </span>
          {entry.resolution ? <span>{entry.resolution}</span> : null}
          <small className="app-muted">
            {entry.byName ?? "A teammate"}
            {entry.mine ? " (you)" : ""}
            {whenLabel(entry.createdAt) ? ` · ${whenLabel(entry.createdAt)}` : ""}
          </small>
        </li>
      ))}
    </ul>
  );
}

function WalkScreen({
  view,
  session,
  busy,
  closed,
  resolution,
  setResolution,
  onAnswer,
  onClose,
  onPickSymptom,
  orgId,
}: {
  view: LiveView;
  session: TroubleshootSessionView;
  busy: boolean;
  closed: "resolved" | "stuck" | null;
  resolution: string;
  setResolution: (value: string) => void;
  onAnswer: (checkId: string, outcomeId: string) => void;
  onClose: (resolved: boolean) => void;
  onPickSymptom: (symptomId: string) => void;
  orgId: string;
}) {
  const symptomLabel = useMemo(
    () => view.symptoms.find((entry) => entry.id === session.symptomId)?.label ?? session.symptomId,
    [session.symptomId, view.symptoms],
  );
  const { walk, grounding, priorSessions } = session;
  const resolvedPrior = priorSessions.filter((entry) => entry.resolved);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Panel>
        <span className="app-badge">Symptom</span>
        <h2 style={{ marginTop: 6, marginBottom: 4 }}>{symptomLabel}</h2>
        {session.aiSuggestion ? (
          <>
            <p className="app-muted" style={{ marginTop: 0 }}>
              AI picked this entry point: {session.aiSuggestion.rationale} It only chose where to start and
              reworded the first question — the checks and fixes below are the curated tree, unchanged.
            </p>
            {walk.history.length === 0 ? (
              <p style={{ marginTop: 0 }}>
                <strong>In your words:</strong> {session.aiSuggestion.restatedCheck}
              </p>
            ) : null}
            <ModelProvenance meta={session.aiProvenance} />
          </>
        ) : null}
        {session.aiNote ? (
          <p className="app-muted" style={{ marginTop: 0 }}>
            {session.aiNote}
          </p>
        ) : null}
        {session.alternatives.length > 1 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 8 }}>
            <span className="app-muted">Not this?</span>
            {session.alternatives
              .filter((entry) => entry.symptomId !== session.symptomId)
              .map((entry) => (
                <button
                  key={entry.symptomId}
                  type="button"
                  className="app-button secondary"
                  style={TAP}
                  disabled={busy}
                  onClick={() => onPickSymptom(entry.symptomId)}
                >
                  {entry.label}
                </button>
              ))}
          </div>
        ) : null}
      </Panel>

      {resolvedPrior.length > 0 ? (
        <Panel>
          <span className="app-badge good">Your team hit this before</span>
          <h2 style={{ marginTop: 6 }}>What your team did last time</h2>
          <SessionList sessions={resolvedPrior} />
        </Panel>
      ) : null}

      {grounding.rows.length > 0 ? (
        <Panel>
          <h2 style={{ marginTop: 0 }}>From your own records</h2>
          <p className="app-muted" style={{ marginTop: 0 }}>
            Rows your team wrote that mention this symptom. Read these before running the checks — they may
            answer it outright.
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
            {grounding.rows.map((row) => (
              <li
                key={row.id}
                style={{
                  border: "1px solid var(--app-line)",
                  borderRadius: "var(--app-radius)",
                  padding: 12,
                  display: "grid",
                  gap: 4,
                }}
              >
                <small className="app-muted">{row.sourceLabel}</small>
                <strong>{row.title}</strong>
                {row.detail ? <span>{row.detail}</span> : null}
                <a href={orgId ? `${row.href}?orgId=${encodeURIComponent(orgId)}` : row.href}>
                  Open {row.sourceLabel.toLowerCase()}
                  {whenLabel(row.when) ? ` · ${whenLabel(row.when)}` : ""}
                </a>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {walk.history.length > 0 ? (
        <Panel>
          <h2 style={{ marginTop: 0 }}>What you have ruled out</h2>
          <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 12 }}>
            {walk.history.map((step) => (
              <li key={step.checkId}>
                <div>{step.action}</div>
                <div className="app-muted">
                  <strong>You saw:</strong> {step.answeredLabel}
                </div>
                <div className="app-muted">
                  <strong>Rules out:</strong> {step.rulesOut}
                </div>
              </li>
            ))}
          </ol>
          <p className="app-muted" style={{ marginBottom: 0 }}>
            About {walk.minutesSpent} minute(s) of checking so far.
          </p>
        </Panel>
      ) : null}

      {walk.current ? (
        <NextCheck check={walk.current} busy={busy} onAnswer={onAnswer} />
      ) : null}

      {walk.fix ? (
        <Panel>
          <span className="app-badge good">Do this</span>
          <h2 style={{ marginTop: 8 }}>{walk.fix.title}</h2>
          <ol style={{ paddingLeft: 20, display: "grid", gap: 8 }}>
            {walk.fix.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p>
            <strong>Why this works:</strong> {walk.fix.principle}
          </p>
          <p style={{ marginBottom: 0 }}>
            <a href={walk.fix.doc.url} target="_blank" rel="noreferrer noopener">
              {walk.fix.doc.label}
            </a>
            {(walk.fix.moreDocs ?? []).map((doc) => (
              <span key={doc.url}>
                {" · "}
                <a href={doc.url} target="_blank" rel="noreferrer noopener">
                  {doc.label}
                </a>
              </span>
            ))}
          </p>
        </Panel>
      ) : null}

      {walk.invalid ? (
        <EmptyState
          badge="Out of date"
          badgeTone="setup"
          title="That step no longer matches the guide"
          description="Start the walk again — the checklist was updated while you were on this page."
        />
      ) : null}

      {walk.fix || walk.history.length > 0 ? (
        <Panel>
          <h2 style={{ marginTop: 0 }}>Did that fix it?</h2>
          {closed === "resolved" ? (
            <p>
              Saved. The next teammate who opens this symptom will see what you did — that is the point of
              writing it down.
            </p>
          ) : closed === "stuck" ? (
            <div style={{ display: "grid", gap: 10 }}>
              <p style={{ margin: 0 }}>
                Saved as still open, with the checks you already ruled out. Take it to a person now:
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <a
                  className="app-button"
                  style={TAP}
                  href={`/team?tab=messages&orgId=${encodeURIComponent(orgId)}`}
                >
                  Ask in team chat
                </a>
                <a
                  className="app-button secondary"
                  style={TAP}
                  href={`/team?tab=knowledge&orgId=${encodeURIComponent(orgId)}`}
                >
                  Write it into the playbook
                </a>
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              <label htmlFor="troubleshoot-resolution" className="app-muted">
                What actually happened? (optional, but this is what the next student reads)
              </label>
              <textarea
                id="troubleshoot-resolution"
                value={resolution}
                rows={3}
                onChange={(event) => setResolution(event.target.value)}
                placeholder="e.g. the USB cable was charge-only — swapped it and the imaging tool saw the rio immediately"
                style={{ width: "100%", minHeight: 80, padding: 12 }}
              />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button
                  type="button"
                  className="app-button"
                  style={TAP}
                  disabled={busy}
                  onClick={() => onClose(true)}
                >
                  This fixed it
                </button>
                <button
                  type="button"
                  className="app-button secondary"
                  style={TAP}
                  disabled={busy}
                  onClick={() => onClose(false)}
                >
                  Still stuck
                </button>
              </div>
            </div>
          )}
        </Panel>
      ) : null}

      {grounding.unavailableSources.length > 0 ? (
        <p className="app-muted" style={{ fontSize: "0.85em" }}>
          Not checked on this deployment: {grounding.unavailableSources.join(", ")}.
        </p>
      ) : null}
    </div>
  );
}

/** One check, one question, one tap per possible observation. */
function NextCheck({
  check,
  busy,
  onAnswer,
}: {
  check: TroubleshootCheck;
  busy: boolean;
  onAnswer: (checkId: string, outcomeId: string) => void;
}) {
  return (
    <Panel>
      <span className="app-badge setup">Next check · about {check.minutes} min</span>
      <h2 style={{ marginTop: 8 }}>{check.action}</h2>
      <p className="app-muted">
        <strong>Why this one now:</strong> {check.why}
      </p>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
        {check.outcomes.map((outcome) => (
          <li key={outcome.id}>
            <button
              type="button"
              className="app-button secondary"
              style={{ ...TAP, width: "100%", textAlign: "left" }}
              disabled={busy}
              onClick={() => onAnswer(check.id, outcome.id)}
            >
              {outcome.label}
            </button>
          </li>
        ))}
      </ul>
      {check.doc ? (
        <p style={{ marginBottom: 0 }}>
          <a href={check.doc.url} target="_blank" rel="noreferrer noopener">
            {check.doc.label}
          </a>
        </p>
      ) : null}
    </Panel>
  );
}
