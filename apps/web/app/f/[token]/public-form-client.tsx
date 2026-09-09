"use client";

import { useCallback, useEffect, useState } from "react";
import { optionsFor, type FormQuestion } from "../../../lib/forms/types";

type PublicForm = {
  id: string;
  title: string;
  description: string;
  purpose: string;
  orgName: string;
  teamNumber: number | null;
  questions: FormQuestion[];
};

type State =
  | { kind: "loading" }
  | { kind: "unavailable"; message: string }
  | { kind: "ready"; form: PublicForm }
  | { kind: "sent"; form: PublicForm };

/**
 * The page a prospective student or a parent lands on.
 *
 * They have no Vantage account and may never get one, so this deliberately
 * carries no app shell, no navigation and no sign-in prompt — just the team's
 * name, the questions, and one button.
 */
export default function PublicFormClient({ token }: { token: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [draft, setDraft] = useState<Record<string, string | string[]>>({});
  const [respondent, setRespondent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/public-forms/${encodeURIComponent(token)}`);
      const data = (await response.json()) as { form?: PublicForm; error?: string };
      if (!response.ok || !data.form) {
        setState({ kind: "unavailable", message: data.error ?? "This form is not available." });
        return;
      }
      setState({ kind: "ready", form: data.form });
    } catch {
      setState({ kind: "unavailable", message: "We could not reach the team's form right now." });
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.kind === "loading") {
    return (
      <main className="public-form">
        <p className="public-form-muted">Loading…</p>
      </main>
    );
  }

  if (state.kind === "unavailable") {
    return (
      <main className="public-form">
        <div className="public-form-card">
          <h1>This form is not available</h1>
          <p className="public-form-muted">{state.message}</p>
          <p className="public-form-muted">
            If someone sent you this link, ask them for a new one — teams close forms when they have what they need.
          </p>
        </div>
      </main>
    );
  }

  const { form } = state;

  if (state.kind === "sent") {
    return (
      <main className="public-form">
        <div className="public-form-card">
          <p className="public-form-team">
            {form.orgName}
            {form.teamNumber ? ` · Team ${form.teamNumber}` : ""}
          </p>
          <h1>Thanks — that is sent.</h1>
          <p className="public-form-muted">
            {form.orgName} has your answers. You do not need a Vantage account, and there is nothing else to do.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="public-form">
      <div className="public-form-card">
        <p className="public-form-team">
          {form.orgName}
          {form.teamNumber ? ` · Team ${form.teamNumber}` : ""}
        </p>
        <h1>{form.title}</h1>
        {form.description ? <p className="public-form-lead">{form.description}</p> : null}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            const missing = form.questions.filter((question) => {
              if (!question.required) return false;
              const value = draft[question.id];
              const text = Array.isArray(value) ? value.join("") : value;
              return !text || !String(text).trim();
            });
            if (missing.length > 0) {
              setError(`Please answer: ${missing.map((question) => question.label).join(", ")}`);
              return;
            }
            setBusy(true);
            setError("");
            void (async () => {
              try {
                const response = await fetch(`/api/public-forms/${encodeURIComponent(token)}`, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    respondent,
                    answers: form.questions.map((question) => ({
                      questionId: question.id,
                      value: draft[question.id] ?? "",
                    })),
                  }),
                });
                const data = (await response.json()) as { error?: string };
                if (!response.ok) {
                  setError(data.error ?? "We could not send that.");
                  return;
                }
                setState({ kind: "sent", form });
              } catch {
                setError("We could not reach the team right now. Please try again in a minute.");
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          <div className="forms-field">
            <label htmlFor="public-form-name">Your name</label>
            <input
              id="public-form-name"
              name="name"
              autoComplete="name"
              value={respondent}
              onChange={(event) => setRespondent(event.target.value)}
              placeholder="So the team knows who answered"
            />
          </div>

          {form.questions.map((question) => {
            const options = optionsFor(question);
            const value = draft[question.id];
            const id = `q-${question.id}`;
            return (
              <div key={question.id} className="forms-field">
                <label htmlFor={id}>
                  {question.label}
                  {question.required ? <span aria-hidden="true"> *</span> : null}
                </label>
                {question.help ? <small className="public-form-muted">{question.help}</small> : null}

                {question.kind === "long_text" ? (
                  <textarea
                    id={id}
                    rows={3}
                    value={String(value ?? "")}
                    onChange={(event) => setDraft((prev) => ({ ...prev, [question.id]: event.target.value }))}
                  />
                ) : question.kind === "multi_select" && options.length > 0 ? (
                  <div className="forms-options" role="group" aria-label={question.label}>
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
                  <select
                    id={id}
                    value={String(value ?? "")}
                    onChange={(event) => setDraft((prev) => ({ ...prev, [question.id]: event.target.value }))}
                  >
                    <option value="">Choose…</option>
                    {options.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={id}
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
                    autoComplete={
                      question.kind === "email" ? "email" : question.kind === "phone" ? "tel" : undefined
                    }
                    min={question.config.min}
                    max={question.config.max}
                    step={question.config.step}
                    value={String(value ?? "")}
                    onChange={(event) => setDraft((prev) => ({ ...prev, [question.id]: event.target.value }))}
                  />
                )}
              </div>
            );
          })}

          {error ? <p role="alert" className="public-form-error">{error}</p> : null}

          <button type="submit" className="public-form-submit" disabled={busy}>
            {busy ? "Sending…" : "Send to the team"}
          </button>
          <p className="public-form-fine">
            Your answers go to {form.orgName} only. You do not need an account.
          </p>
        </form>
      </div>
    </main>
  );
}
