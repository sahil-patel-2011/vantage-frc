"use client";

import { useState } from "react";
import { Button } from "../../../../components/ui";
import { passRuleSentence } from "../../../../lib/team-lessons/body";
import type { LessonAttempt, PracticeResult, PublicQuestion } from "../../../../lib/team-lessons/types";
import { lessonFetch, whenText } from "../lesson-shared";

type Submitted = { result: PracticeResult; stored: boolean; attempt: LessonAttempt | null };

function QuestionField({
  question,
  number,
  value,
  onChange,
  disabled,
}: {
  question: PublicQuestion;
  number: number;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const label = `team-lesson-q-${question.id}`;
  if (question.kind === "choice") {
    return (
      <fieldset className="team-lesson-question-field" disabled={disabled}>
        <legend id={label}>
          {number}. {question.prompt}
        </legend>
        {question.options.map((option, index) => (
          <label key={index} className="team-lesson-option">
            <input
              type="radio"
              name={label}
              value={String(index)}
              checked={value === String(index)}
              onChange={() => onChange(String(index))}
            />
            <span>{option}</span>
          </label>
        ))}
      </fieldset>
    );
  }
  return (
    <div className="team-lesson-question-field">
      <label htmlFor={label} className="team-lesson-question-prompt">
        {number}. {question.prompt}
      </label>
      <div className="team-lesson-answer-row">
        <input
          id={label}
          className="team-lesson-input"
          type="text"
          inputMode={question.kind === "number" ? "decimal" : "text"}
          autoComplete="off"
          spellCheck={question.kind === "text"}
          maxLength={200}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        {question.kind === "number" && question.unit ? <span className="team-lesson-unit">{question.unit}</span> : null}
      </div>
    </div>
  );
}

export function LessonPractice({
  lessonId,
  orgId,
  questions,
  previewOnly,
  attempts,
  onAttempt,
}: {
  lessonId: string;
  orgId: string;
  questions: PublicQuestion[];
  /** A draft previewed by its editor: graded, not recorded. */
  previewOnly: boolean;
  attempts: LessonAttempt[];
  onAttempt: (attempt: LessonAttempt) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState<Submitted | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    setBusy(true);
    setError(null);
    const payload: Record<string, number | string> = {};
    for (const question of questions) {
      const value = answers[question.id];
      if (value === undefined || value === "") continue;
      payload[question.id] = question.kind === "choice" ? Number(value) : value;
    }
    const response = await lessonFetch<Submitted>(`/api/team-lessons/${lessonId}`, {
      method: "POST",
      body: JSON.stringify({ orgId, action: "submit", answers: payload }),
    });
    setBusy(false);
    if (!response.ok || !response.data) {
      setError(response.error ?? (response.status === 0 ? "Couldn't reach Vantage. Your answers are still here; try again." : "Your answers couldn't be checked. Try again."));
      return;
    }
    setSubmitted(response.data);
    if (response.data.attempt) onAttempt(response.data.attempt);
  }

  function retry() {
    setSubmitted(null);
    setError(null);
  }

  const byId = new Map(submitted?.result.results.map((result) => [result.id, result]) ?? []);
  const result = submitted?.result;

  return (
    <section className="team-lesson-practice" aria-labelledby="team-lesson-practice-title">
      <h2 id="team-lesson-practice-title">Practice</h2>
      <p className="app-muted">
        {passRuleSentence(questions.length)} Vantage checks your answers and tells you which ones to look at again.
        {previewOnly ? " This is a preview of a draft, so results aren't saved." : ""}
      </p>
      <form
        className="team-lesson-questions"
        onSubmit={(event) => {
          event.preventDefault();
          if (!submitted) void check();
        }}
      >
        <ol>
          {questions.map((question, index) => {
            const graded = byId.get(question.id);
            return (
              <li key={question.id} className={`team-lesson-question${graded ? (graded.correct ? " is-correct" : " is-wrong") : ""}`}>
                <QuestionField
                  question={question}
                  number={index + 1}
                  value={answers[question.id] ?? ""}
                  disabled={busy || Boolean(submitted)}
                  onChange={(value) => setAnswers((prev) => ({ ...prev, [question.id]: value }))}
                />
                {graded ? (
                  <p className="team-lesson-feedback">
                    <strong>{graded.correct ? "✓ Correct" : "✗ Not yet"}</strong>
                    {graded.feedback && graded.feedback !== "Correct." ? ` — ${graded.feedback}` : ""}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
        {error ? (
          <p className="team-lesson-notice" role="alert">
            {error}
          </p>
        ) : null}
        <div role="status" aria-live="polite">
          {result ? (
            <p className={`team-lesson-score${result.passed ? " is-passed" : ""}`}>
              {result.passed
                ? `You got ${result.score} of ${result.total}. Passed!`
                : `You got ${result.score} of ${result.total}. You need ${result.passMark} to pass — fix the ones marked “Not yet” and try again.`}
              {submitted?.stored ? "" : previewOnly ? " (Preview — not saved.)" : ""}
            </p>
          ) : null}
        </div>
        <div className="team-lesson-actions">
          {submitted ? (
            <Button variant={result?.passed ? "secondary" : "primary"} onClick={retry}>
              {result?.passed ? "Practice again" : "Try again"}
            </Button>
          ) : (
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? "Checking…" : "Check my answers"}
            </Button>
          )}
        </div>
      </form>
      {attempts.length ? (
        <details className="team-lesson-attempts">
          <summary data-disclosure>Your earlier tries ({attempts.length})</summary>
          <ul>
            {attempts.slice(0, 10).map((attempt) => (
              <li key={attempt.id}>
                {attempt.score} of {attempt.total}
                {attempt.passed ? " · Passed" : ""} · {whenText(attempt.createdAt)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
