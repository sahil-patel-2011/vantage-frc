"use client";

import { useEffect, useReducer, useRef } from "react";
import { Button } from "../../../../components/ui";
import { passRuleSentence } from "../../../../lib/team-lessons/body";
import {
  answersLocked,
  firstToRevisit,
  INITIAL_PRACTICE,
  practicePayload,
  practiceReducer,
} from "../../../../lib/team-lessons/practice-state";
import type { LessonAttempt, PracticeSubmission, PublicQuestion } from "../../../../lib/team-lessons/types";
import { lessonFetch, whenText } from "../lesson-shared";

/** Tries listed under the practice; the summary's count matches this list. */
const ATTEMPTS_SHOWN = 10;

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
  const [state, dispatch] = useReducer(practiceReducer, INITIAL_PRACTICE);
  const { answers, submitted, error, phase } = state;
  const locked = answersLocked(state);
  const busy = phase === "checking";
  const formRef = useRef<HTMLFormElement | null>(null);
  /** Set by Try again: the question to put the cursor in once its field is enabled again. */
  const focusAfterRetry = useRef<string | null>(null);

  async function check() {
    if (phase !== "answering") return;
    dispatch({ type: "check" });
    const response = await lessonFetch<PracticeSubmission>(`/api/team-lessons/${lessonId}`, {
      method: "POST",
      body: JSON.stringify({ orgId, action: "submit", answers: practicePayload(questions, answers) }),
    });
    if (!response.ok || !response.data) {
      dispatch({
        type: "failed",
        error: response.error ?? (response.status === 0 ? "Couldn't reach Vantage. Your answers are still here; try again." : "Your answers couldn't be checked. Try again."),
      });
      return;
    }
    dispatch({ type: "checked", submitted: response.data });
    if (response.data.attempt) onAttempt(response.data.attempt);
  }

  function retry() {
    focusAfterRetry.current = firstToRevisit(submitted, questions.map((question) => question.id)) ?? questions[0]?.id ?? null;
    dispatch({ type: "retry" });
  }

  // After Try again the fields are enabled on the next render; then put the cursor in the
  // first one marked "Not yet" (the checked option of a choice, else its first option).
  useEffect(() => {
    const id = focusAfterRetry.current;
    if (phase !== "answering" || !id) return;
    focusAfterRetry.current = null;
    const target = formRef.current?.querySelector<HTMLElement>(`[id="team-lesson-q-${id}"]`);
    const field =
      target instanceof HTMLInputElement
        ? target
        : target?.closest("fieldset")?.querySelector<HTMLInputElement>("input:checked, input");
    field?.focus();
  }, [phase]);

  const byId = new Map(submitted?.result.results.map((result) => [result.id, result]) ?? []);
  const result = submitted?.result;
  const recent = attempts.slice(0, ATTEMPTS_SHOWN);

  return (
    <section className="team-lesson-practice" aria-labelledby="team-lesson-practice-title">
      <h2 id="team-lesson-practice-title">Practice</h2>
      <p className="app-muted">
        {passRuleSentence(questions.length)} Vantage checks your answers and tells you which ones to look at again.
        {previewOnly ? " This is a preview of a draft, so results aren't saved." : ""}
      </p>
      <form
        ref={formRef}
        className="team-lesson-questions"
        onSubmit={(event) => {
          event.preventDefault();
          void check();
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
                  disabled={locked}
                  onChange={(value) => dispatch({ type: "answer", id: question.id, value })}
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
          {/* Separate keys on purpose. Without them React reused one <button> and flipped its
              type from "button" to "submit" during the Try again click, so the browser then
              submitted the form: the same answers were graded again and the fields locked. */}
          {submitted ? (
            <Button key="retry" variant={result?.passed ? "secondary" : "primary"} onClick={retry}>
              {result?.passed ? "Practice again" : "Try again"}
            </Button>
          ) : (
            <Button key="check" variant="primary" type="submit" disabled={busy}>
              {busy ? "Checking…" : "Check my answers"}
            </Button>
          )}
        </div>
      </form>
      {recent.length ? (
        <details className="team-lesson-attempts">
          {/* The count is what the list shows, not what the server sent (up to 20). */}
          <summary data-disclosure>Your recent tries ({recent.length})</summary>
          <ul>
            {recent.map((attempt) => (
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
