"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "../../../components/offline-banner";
import { Badge, EmptyState, PageHeader, Panel, Button } from "../../../components/ui";
import type { FormInsight, QuestionSummary } from "../../../lib/forms/results";
import {
  optionsFor,
  PURPOSE_LABELS,
  QUESTION_KINDS,
  QUESTION_KIND_LABELS,
  type FormQuestion,
  type QuestionKind,
} from "../../../lib/forms/types";
import { FEATURE_API_TIMEOUT_MS } from "../../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../../lib/offline/feature-cache";

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

type DuesRecipient = { userId: string; name: string; reason: "owing" | "no_response" };

type DuesPlan = {
  ready: boolean;
  blockedReason?: string;
  questionLabel?: string;
  owing: DuesRecipient[];
  noResponse: DuesRecipient[];
  assistance: number;
  paid: number;
  unreadable: number;
  offPlatform: number;
  remindedToday: number;
};

type View = {
  orgName: string;
  canManage: boolean;
  form: FormDetail;
  // Null for a non-manager: RLS shows them only their own response, so the API
  // deliberately withholds a figure that would read as team-wide.
  results: {
    totalResponses: number;
    assignedCount: number;
    respondedAssignees: number;
    summaries: QuestionSummary[];
    responses: Array<{ id: string; label: string; submittedAt: string; hasAccount: boolean }>;
    linkResponses: number;
    // Null for a non-manager. RLS shows them only their own response, so the
    // API withholds the team-wide figures rather than sending a number that
    // would read as the team's and is really just theirs.
  } | null;
  insight: FormInsight | null;
  duesPlan: DuesPlan | null;
};

type Mode = "build" | "answer" | "results";

function isFormDetailView(value: unknown): value is View {
  if (!value || typeof value !== "object") return false;
  const form = (value as View).form;
  return Boolean(form && typeof form === "object" && typeof form.id === "string" && form.id.trim());
}

async function persistFormDetailSnapshot(orgHint: string, formId: string, data: View): Promise<void> {
  if (!formId.trim()) return;
  const cacheOrg = orgHint.trim() || "_";
  try {
    await putFeatureSnapshot("form-detail", cacheOrg, data, formId);
    if (!orgHint.trim()) await putFeatureSnapshot("form-detail", "_", data, formId);
  } catch {
    // Live form already painted; IndexedDB is best-effort.
  }
}

/**
 * The workspace the shell sent us to. Without it the API resolves the caller's
 * first membership by org name, so a member of two teams could open a form
 * belonging to the team they are not currently in.
 */
function orgParam(): string {
  if (typeof window === "undefined") return "";
  const orgId = new URLSearchParams(window.location.search).get("orgId");
  return orgId ? `&orgId=${encodeURIComponent(orgId)}` : "";
}

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

/**
 * The dues send, shown as a decision rather than a button.
 *
 * Everything about who is excluded is on screen before the treasurer can act,
 * and the assistance line is deliberately a count with no names: the point is
 * that those people are not being chased, not to put a list of families who
 * cannot pay in front of whoever is looking at the screen.
 */
function DuesReminderPanel({
  plan,
  busy,
  onSend,
  result,
}: {
  plan: DuesPlan;
  busy: boolean;
  onSend: (includeNoResponse: boolean) => void;
  result: string;
}) {
  const [includeNoResponse, setIncludeNoResponse] = useState(true);

  if (!plan.ready) {
    return (
      <Panel className="forms-dues-panel">
        <h2>Dues reminders</h2>
        <p className="app-muted">{plan.blockedReason}</p>
      </Panel>
    );
  }

  const willEmail = plan.owing.length + (includeNoResponse ? plan.noResponse.length : 0);

  return (
    <Panel className="forms-dues-panel">
      <h2>Dues reminders</h2>
      <p className="app-muted">
        Read from “{plan.questionLabel}”. Nothing here sends on a schedule — a reminder goes out only when
        you send it, and never more than once a day per person.
      </p>

      <ul className="forms-dues-groups">
        <li>
          <strong>{plan.owing.length}</strong> answered that dues are outstanding
          {plan.owing.length > 0 ? <small>{plan.owing.map((row) => row.name).join(", ")}</small> : null}
        </li>
        <li>
          <strong>{plan.noResponse.length}</strong>{" "}
          {plan.noResponse.length === 1 ? "was" : "were"} assigned this form and{" "}
          {plan.noResponse.length === 1 ? "has" : "have"} not answered
          {plan.noResponse.length > 0 ? (
            <small>{plan.noResponse.map((row) => row.name).join(", ")}</small>
          ) : null}
        </li>
        <li className="forms-dues-protected">
          <strong>{plan.assistance}</strong> asked for financial assistance
          <small>
            Never emailed, by design. Follow up privately — the names are in the responses below.
          </small>
        </li>
        <li>
          <strong>{plan.paid}</strong> answered that they are paid up
        </li>
        {plan.offPlatform > 0 ? (
          <li>
            <strong>{plan.offPlatform}</strong> owe but answered through the share link
            <small>No Vantage account, so no address we are allowed to email. Reach them another way.</small>
          </li>
        ) : null}
        {plan.unreadable > 0 ? (
          <li>
            <strong>{plan.unreadable}</strong> gave an answer this page could not read as paid or unpaid
            <small>Left out rather than guessed at.</small>
          </li>
        ) : null}
        {plan.remindedToday > 0 ? (
          <li>
            <strong>{plan.remindedToday}</strong> were already reminded today
          </li>
        ) : null}
      </ul>

      <label className="forms-dues-check">
        <input
          type="checkbox"
          checked={includeNoResponse}
          onChange={(event) => setIncludeNoResponse(event.target.checked)}
        />
        Also nudge the {plan.noResponse.length}{" "}
        {plan.noResponse.length === 1 ? "person who has" : "who have"} not returned the form
      </label>

      <Button variant="primary" type="button" disabled={busy || willEmail === 0} onClick={() => onSend(includeNoResponse)}>
        {willEmail === 0 ? "Nobody to remind" : `Send ${willEmail} reminder${willEmail === 1 ? "" : "s"}`}
      </Button>
      {result ? (
        <p role="status" className="app-muted forms-dues-result">
          {result}
        </p>
      ) : null}
    </Panel>
  );
}

/**
 * What we will not do with an address someone typed into a form.
 *
 * A prospective student fills in an intake link and writes their email in a
 * question. That address belongs to the team's conversation with them, not to
 * Vantage's mailing list: there is no account, no preferences row, no
 * unsubscribe token, and no way to know the address is even theirs. So this
 * says so plainly and points at the one path that does carry consent — an
 * invite the person accepts.
 */
function OffPlatformRespondents({ count }: { count: number }) {
  return (
    <Panel className="forms-offplatform-panel">
      <h2>
        {count} {count === 1 ? "answer" : "answers"} came from someone with no account
      </h2>
      <p className="app-muted">
        Vantage will not email them. They gave that address to your team, not to us — there is no
        account behind it, nothing to unsubscribe from, and no way for us to know it is really theirs.
        Several of them are likely to be minors.
      </p>
      <p className="app-muted">
        Invite the ones you want on the team. When they accept and create an account they get a
        preferences page, an unsubscribe link, and the short onboarding sequence — all of which start
        from a decision they made.
      </p>
      <Button as="a" variant="secondary" href="/team/admin">
        Invite someone to the team
      </Button>
    </Panel>
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
  const [duesResult, setDuesResult] = useState("");
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<View | null>(null);
  viewRef.current = view;

  // Which workspace this form belongs to. Without it the API falls back to the
  // caller's alphabetically first membership, so a form in a second team is
  // unopenable — see formHref in ../forms-client.
  const { readUrl, writeUrl, orgHint } = useMemo(() => {
    const orgId =
      typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("orgId");
    const org = orgId ? `orgId=${encodeURIComponent(orgId)}` : "";
    return {
      orgHint: orgId?.trim() ?? "",
      readUrl: `/api/forms?formId=${encodeURIComponent(formId)}${org ? `&${org}` : ""}`,
      writeUrl: org ? `/api/forms?${org}` : "/api/forms",
    };
  }, [formId]);

  const load = useCallback(async () => {
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<View>("form-detail", orgHint || "_", formId);
      if (!viewRef.current && cached?.data && isFormDetailView(cached.data)) {
        setView(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    try {
      const response = await fetch(readUrl, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "Could not load this form.",
        );
        return;
      }
      if (!response.ok || !isFormDetailView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh this form. Showing the last copy on this device.");
          return;
        }
        setError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "Could not load this form.",
        );
        return;
      }
      setView(data);
      setError("");
      setFromCache(false);
      setCachedAt(null);
      await persistFormDetailSnapshot(orgHint, formId, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh this form. Showing the last copy on this device.");
        return;
      }
      setError("Could not reach the server.");
    }
  }, [formId, orgHint, readUrl]);

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
        const response = await fetch(writeUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
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
        <OfflineBanner feature="Form" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState soft badge="Not available" badgeTone="setup" title="This form could not be opened" description={error}>
          <Button as="a" variant="primary" href={`/forms${orgParam().replace("&", "?")}`}>Back to forms</Button>
        </EmptyState>
      </main>
    );
  }

  if (!view) {
    return (
      <main className="module-page forms-page">
        <PageHeader breadcrumbs="Team / Forms" title="Form" />
        <OfflineBanner feature="Form" fromCache={fromCache} cachedAt={cachedAt} />
        <Panel><p className="app-muted">Loading…</p></Panel>
      </main>
    );
  }

  async function sendDuesReminders(includeNoResponse: boolean) {
    setBusy(true);
    setDuesResult("");
    try {
      const response = await fetch(writeUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "send_dues_reminders", formId, includeNoResponse }),
      });
      const data = (await response.json()) as {
        error?: string;
        dues?: {
          sent: number;
          skippedPref: number;
          alreadyReminded: number;
          failed: number;
          assistanceFlagged: number;
        };
      };
      if (!response.ok || !data.dues) {
        setDuesResult(data.error ?? "Could not send the reminders.");
        return;
      }
      // Report what happened, including the parts a treasurer would otherwise
      // never find out: opt-outs, failures, and the people left alone.
      const parts = [`Sent ${data.dues.sent}`];
      if (data.dues.skippedPref > 0) parts.push(`${data.dues.skippedPref} have dues email turned off`);
      if (data.dues.alreadyReminded > 0) parts.push(`${data.dues.alreadyReminded} already reminded today`);
      if (data.dues.failed > 0) parts.push(`${data.dues.failed} failed`);
      if (data.dues.assistanceFlagged > 0) {
        parts.push(
          `${data.dues.assistanceFlagged} who asked for assistance were not emailed — leadership has an inbox note to follow up`,
        );
      }
      setDuesResult(`${parts.join(" · ")}.`);
      await load();
    } finally {
      setBusy(false);
    }
  }

  const { form, results, insight, canManage, duesPlan } = view;
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

      <OfflineBanner feature="Form" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

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
                <Button variant="primary" type="button" disabled={busy || form.questions.length === 0} onClick={() => void act({ action: "set_status", formId: form.id, status: "open", audience: form.audience })}>
                  Open for answers
                </Button>
              ) : (
                <Button variant="secondary" type="button" disabled={busy} onClick={() => void act({ action: "set_status", formId: form.id, status: "closed", audience: form.audience })}>
                  Close
                </Button>
              )}
              <Button variant="secondary" type="button" disabled={busy} onClick={() => void act({ action: "set_status", formId: form.id, status: form.status, audience: form.audience === "link" ? "members" : "link", }) }>
                {form.audience === "link" ? "Restrict to members" : "Allow anyone with the link"}
              </Button>
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
            <Button variant="primary" type="submit" disabled={busy || !newLabel.trim()}>Add question</Button>
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
            <Button variant="primary" type="submit" disabled={busy || form.status !== "open" || form.questions.length === 0}>
              Submit
            </Button>
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

          {duesPlan ? (
            <DuesReminderPanel
              plan={duesPlan}
              busy={busy}
              onSend={(includeNoResponse) => void sendDuesReminders(includeNoResponse)}
              result={duesResult}
            />
          ) : null}

          {results.linkResponses > 0 ? <OffPlatformRespondents count={results.linkResponses} /> : null}

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
