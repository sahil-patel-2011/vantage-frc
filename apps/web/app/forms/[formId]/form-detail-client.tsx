"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, EmptyState, PageHeader, Panel } from "../../../components/ui";
import type { FormInsight, QuestionSummary } from "../../../lib/forms/results";
import {
  optionsFor,
  PURPOSE_LABELS,
  QUESTION_KINDS,
  QUESTION_KIND_LABELS,
  type FormQuestion,
  type QuestionKind,
} from "../../../lib/forms/types";

type FormDetail = {
  id: string;
  title: string;
  description: string;
  purpose: keyof typeof PURPOSE_LABELS;
  status: "draft" | "open" | "closed";
  audience: "members" | "link";
  shareToken: string | null;
  questions: FormQuestion[];
};

type View = {
  canManage: boolean;
  form: FormDetail;
  // Null for a non-manager: RLS shows them only their own response, so the API
  // deliberately withholds a figure that would read as team-wide.
  results: {
    totalResponses: number;
    assignedCount: number;
    summaries: QuestionSummary[];
    responses: Array<{ id: string; label: string; submittedAt: string }>;
  } | null;
  insight: FormInsight | null;
};

type Mode = "build" | "answer" | "results";

/** A dependency-free bar. Widths are percentages of the largest bucket. */
function Bar({ label, count, share, max }: { label: string; count: number; share: number; max: number }) {
  const width = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <li className="forms-bar-row">
      <span className="forms-bar-label" title={label}>{label}</span>
      <span className="forms-bar-track" aria-hidden="true">
        <span className={`forms-bar-fill${count === 0 ? " empty" : ""}`} style={{ width: `${width}%` }} />
      </span>
      <span className="forms-bar-value">
        {count}
        <small>{share}%</small>
      </span>
    </li>
  );
}

function QuestionResult({ summary }: { summary: QuestionSummary }) {
  const max = summary.buckets.reduce((most, bucket) => Math.max(most, bucket.count), 0);
  return (
    <section className="forms-result">
      <header>
        <h3>{summary.label}</h3>
        <small className="app-muted">
          {summary.answered} of {summary.totalResponses} answered
        </small>
      </header>

      {summary.buckets.length > 0 ? (
        <ul className="forms-bars">
          {summary.buckets.map((bucket) => (
            <Bar key={bucket.label} label={bucket.label} count={bucket.count} share={bucket.share} max={max} />
          ))}
        </ul>
      ) : null}

      {summary.stats ? (
        <dl className="forms-stats">
          <div><dt>Average</dt><dd>{summary.stats.mean}</dd></div>
          <div><dt>Median</dt><dd>{summary.stats.median}</dd></div>
          <div><dt>Low</dt><dd>{summary.stats.min}</dd></div>
          <div><dt>High</dt><dd>{summary.stats.max}</dd></div>
        </dl>
      ) : null}

      {summary.textAnswers.length > 0 ? (
        <ul className="forms-text-answers">
          {summary.textAnswers.map((answer, index) => (
            <li key={`${summary.questionId}-${index}`}>{answer}</li>
          ))}
        </ul>
      ) : null}

      {summary.reading ? (
        <p className="forms-reading">{summary.reading}</p>
      ) : summary.answered > 0 ? (
        <p className="app-muted forms-reading-muted">
          Not enough answers yet to say anything about the spread.
        </p>
      ) : (
        <p className="app-muted forms-reading-muted">No answers yet.</p>
      )}
    </section>
  );
}

export default function FormDetailClient({ formId }: { formId: string }) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode | null>(null);
  const [draft, setDraft] = useState<Record<string, string | string[]>>({});
  const [newLabel, setNewLabel] = useState("");
  const [newKind, setNewKind] = useState<QuestionKind>("short_text");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/forms?formId=${encodeURIComponent(formId)}`);
      const data = (await response.json()) as View & { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Could not load this form.");
        return;
      }
      setView(data);
      setError("");
    } catch {
      setError("Could not reach the server.");
    }
  }, [formId]);

  useEffect(() => {
    void load();
  }, [load]);

  // The default surface follows the form's own state instead of making the
  // user choose a tab: a draft wants questions, an open form with answers wants
  // results, and a member who cannot manage it just wants to answer.
  const defaultMode: Mode = useMemo(() => {
    if (!view) return "build";
    if (!view.canManage) return "answer";
    if (view.form.status === "draft") return "build";
    return (view.results?.totalResponses ?? 0) > 0 ? "results" : "build";
  }, [view]);

  const active = mode ?? defaultMode;

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const response = await fetch("/api/forms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "That did not work.");
        return false;
      }
      setError("");
      await load();
      return true;
    } finally {
      setBusy(false);
    }
  }

  if (error && !view) {
    return (
      <main className="module-page forms-page">
        <PageHeader breadcrumbs="Team / Forms" title="Form" />
        <EmptyState soft badge="Not available" badgeTone="setup" title="This form could not be opened" description={error}>
          <a className="app-button" href="/forms">Back to forms</a>
        </EmptyState>
      </main>
    );
  }

  if (!view) {
    return (
      <main className="module-page forms-page">
        <PageHeader breadcrumbs="Team / Forms" title="Form" />
        <Panel><p className="app-muted">Loading…</p></Panel>
      </main>
    );
  }

  const { form, results, insight, canManage } = view;
  // The share URL points at the token route, not this page. /forms/<id> is
  // session-gated, so handing it to a prospective student or a parent sends
  // them to a sign-in screen for an account they will never have.
  const shareUrl = form.shareToken ? `${window.location.origin}/f/${form.shareToken}` : null;

  return (
    <main className="module-page forms-page">
      <PageHeader
        breadcrumbs="Team / Forms"
        title={form.title}
        description={`${PURPOSE_LABELS[form.purpose]} · ${form.questions.length} ${form.questions.length === 1 ? "question" : "questions"}`}
      >
        <nav className="forms-modes" aria-label="Form views">
          {(canManage ? (["build", "answer", "results"] as Mode[]) : (["answer"] as Mode[])).map((option) => (
            <button
              key={option}
              type="button"
              className={`app-button${active === option ? "" : " secondary"}`}
              aria-pressed={active === option}
              onClick={() => setMode(option)}
            >
              {option === "build" ? "Questions" : option === "answer" ? "Preview & answer" : `Responses (${results?.totalResponses ?? 0})`}
            </button>
          ))}
        </nav>
      </PageHeader>

      {canManage ? (
        <Panel className="forms-status-panel">
          <div className="forms-status-row">
            <div>
              <h2>Status</h2>
              <p className="app-muted">
                {form.status === "draft"
                  ? "Nobody can answer a draft. Open it when the questions are right."
                  : form.status === "open"
                    ? form.audience === "link"
                      ? "Anyone with the link can answer — use this for prospective students and parents."
                      : "Members of your team can answer."
                    : "Closed. Existing answers are kept and still readable below."}
              </p>
            </div>
            <div className="forms-status-actions">
              <Badge tone={form.status === "open" ? "good" : form.status === "closed" ? "neutral" : "setup"}>
                {form.status}
              </Badge>
              {form.status !== "open" ? (
                <button
                  type="button"
                  className="app-button"
                  disabled={busy || form.questions.length === 0}
                  onClick={() => void act({ action: "set_status", formId: form.id, status: "open", audience: form.audience })}
                >
                  Open for answers
                </button>
              ) : (
                <button
                  type="button"
                  className="app-button secondary"
                  disabled={busy}
                  onClick={() => void act({ action: "set_status", formId: form.id, status: "closed", audience: form.audience })}
                >
                  Close
                </button>
              )}
              <button
                type="button"
                className="app-button secondary"
                disabled={busy}
                onClick={() =>
                  void act({
                    action: "set_status",
                    formId: form.id,
                    status: form.status,
                    audience: form.audience === "link" ? "members" : "link",
                  })
                }
              >
                {form.audience === "link" ? "Restrict to members" : "Allow anyone with the link"}
              </button>
            </div>
          </div>
          {form.questions.length === 0 ? (
            <p className="app-muted forms-hint">Add at least one question before opening the form.</p>
          ) : null}
          {shareUrl && form.audience === "link" ? (
            <p className="forms-share">
              <span>{shareUrl}</span>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  void navigator.clipboard?.writeText(shareUrl);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? "Copied" : "Copy link"}
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      "Make a new link? Anyone still holding the old one will not be able to answer.",
                    )
                  ) {
                    void act({ action: "rotate_link", formId: form.id });
                  }
                }}
              >
                New link
              </button>
            </p>
          ) : null}
        </Panel>
      ) : null}

      {active === "build" && canManage ? (
        <Panel className="forms-build-panel">
          <h2>Questions</h2>
          {form.questions.length === 0 ? (
            <p className="app-muted">No questions yet. Add the first one below.</p>
          ) : (
            <ol className="forms-questions">
              {form.questions.map((question, index) => (
                <li key={question.id}>
                  <div className="forms-question-main">
                    <input
                      className="forms-question-label"
                      defaultValue={question.label}
                      aria-label={`Question ${index + 1} text`}
                      onBlur={(event) => {
                        const next = event.target.value.trim();
                        if (next && next !== question.label) {
                          void act({ action: "update_question", questionId: question.id, label: next });
                        }
                      }}
                    />
                    <small className="app-muted">
                      {QUESTION_KIND_LABELS[question.kind]}
                      {optionsFor(question).length > 0 ? ` · ${optionsFor(question).join(", ")}` : ""}
                    </small>
                  </div>
                  <div className="forms-question-actions">
                    <label className="forms-required">
                      <input
                        type="checkbox"
                        checked={question.required}
                        onChange={(event) =>
                          void act({ action: "update_question", questionId: question.id, required: event.target.checked })
                        }
                      />
                      Required
                    </label>
                    <button type="button" className="text-button" disabled={busy || index === 0}
                      onClick={() => void act({ action: "move_question", questionId: question.id, direction: "up" })}>
                      Up
                    </button>
                    <button type="button" className="text-button" disabled={busy || index === form.questions.length - 1}
                      onClick={() => void act({ action: "move_question", questionId: question.id, direction: "down" })}>
                      Down
                    </button>
                    <button type="button" className="text-button" disabled={busy}
                      onClick={() => {
                        if (window.confirm(`Delete "${question.label}"? Answers to it are deleted too.`)) {
                          void act({ action: "delete_question", questionId: question.id });
                        }
                      }}>
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}

          <form
            className="forms-add"
            onSubmit={(event) => {
              event.preventDefault();
              if (!newLabel.trim()) return;
              void act({ action: "add_question", formId: form.id, kind: newKind, label: newLabel.trim() }).then((ok) => {
                if (ok) setNewLabel("");
              });
            }}
          >
            <label>
              <span>New question</span>
              <input value={newLabel} onChange={(event) => setNewLabel(event.target.value)} placeholder="What size shirt do you wear?" />
            </label>
            <label>
              <span>Answer type</span>
              <select value={newKind} onChange={(event) => setNewKind(event.target.value as QuestionKind)}>
                {QUESTION_KINDS.map((kind) => (
                  <option key={kind} value={kind}>{QUESTION_KIND_LABELS[kind]}</option>
                ))}
              </select>
            </label>
            <button type="submit" className="app-button" disabled={busy || !newLabel.trim()}>Add question</button>
          </form>
          {error ? <p role="alert" className="forms-error">{error}</p> : null}
        </Panel>
      ) : null}

      {active === "answer" ? (
        <Panel className="forms-answer-panel">
          <h2>{canManage ? "Preview & answer" : form.title}</h2>
          {form.status !== "open" ? (
            <p className="app-muted">This form is not open for answers yet.</p>
          ) : null}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const answers = form.questions.map((question) => ({
                questionId: question.id,
                value: draft[question.id] ?? "",
              }));
              void act({ action: "submit", formId: form.id, answers }).then((ok) => {
                if (ok) setDraft({});
              });
            }}
          >
            {form.questions.map((question) => {
              const options = optionsFor(question);
              const value = draft[question.id];
              return (
                <div key={question.id} className="forms-field">
                  <label htmlFor={`q-${question.id}`}>
                    {question.label}
                    {question.required ? <span aria-hidden="true"> *</span> : null}
                  </label>
                  {question.help ? <small className="app-muted">{question.help}</small> : null}

                  {question.kind === "long_text" ? (
                    <textarea id={`q-${question.id}`} rows={3} value={String(value ?? "")}
                      required={question.required}
                      onChange={(event) => setDraft((prev) => ({ ...prev, [question.id]: event.target.value }))} />
                  ) : options.length > 0 && question.kind === "multi_select" ? (
                    <div className="forms-options" role="group" aria-labelledby={`q-${question.id}`}>
                      {options.map((option) => {
                        const list = Array.isArray(value) ? value : [];
                        return (
                          <label key={option} className="forms-option">
                            <input
                              type="checkbox"
                              checked={list.includes(option)}
                              onChange={(event) =>
                                setDraft((prev) => {
                                  const current = Array.isArray(prev[question.id]) ? (prev[question.id] as string[]) : [];
                                  return {
                                    ...prev,
                                    [question.id]: event.target.checked
                                      ? [...current, option]
                                      : current.filter((entry) => entry !== option),
                                  };
                                })
                              }
                            />
                            {option}
                          </label>
                        );
                      })}
                    </div>
                  ) : options.length > 0 ? (
                    <select id={`q-${question.id}`} value={String(value ?? "")} required={question.required}
                      onChange={(event) => setDraft((prev) => ({ ...prev, [question.id]: event.target.value }))}>
                      <option value="">Choose…</option>
                      {options.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  ) : (
                    <input
                      id={`q-${question.id}`}
                      type={
                        question.kind === "number" || question.kind === "scale" || question.kind === "counter"
                          ? "number"
                          : question.kind === "date"
                            ? "date"
                            : question.kind === "email"
                              ? "email"
                              : question.kind === "phone"
                                ? "tel"
                                : "text"
                      }
                      inputMode={question.kind === "phone" ? "tel" : undefined}
                      autoComplete={
                        question.kind === "email" ? "email" : question.kind === "phone" ? "tel" : undefined
                      }
                      min={question.config.min}
                      max={question.config.max}
                      step={question.config.step}
                      required={question.required}
                      value={String(value ?? "")}
                      onChange={(event) => setDraft((prev) => ({ ...prev, [question.id]: event.target.value }))}
                    />
                  )}
                </div>
              );
            })}
            <button type="submit" className="app-button" disabled={busy || form.status !== "open" || form.questions.length === 0}>
              Submit
            </button>
            {error ? <p role="alert" className="forms-error">{error}</p> : null}
          </form>
        </Panel>
      ) : null}

      {active === "results" && canManage && results && insight ? (
        <>
          <Panel className="forms-insight-panel">
            <h2>{insight.headline}</h2>
            <p>{insight.detail}</p>
            {insight.provisional ? (
              <p className="forms-provisional">
                Based on very few responses — treat this as a first look, not a conclusion.
              </p>
            ) : null}
          </Panel>

          {results.totalResponses === 0 ? (
            <EmptyState
              soft
              badge="No responses"
              badgeTone="setup"
              title="Nothing to read yet"
              description="Charts and readings appear here as soon as people answer. Nothing is estimated or filled in."
            />
          ) : (
            <Panel className="forms-results-panel">
              {results.summaries.map((summary) => (
                <QuestionResult key={summary.questionId} summary={summary} />
              ))}
            </Panel>
          )}
        </>
      ) : null}
    </main>
  );
}
