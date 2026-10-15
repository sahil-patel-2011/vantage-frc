"use client";

import { useId } from "react";
import { askConfirm, Button } from "../../../../../components/ui";
import { newContentId, passRuleSentence } from "../../../../../lib/team-lessons/body";
import {
  LESSON_LIMITS,
  type ChoiceQuestion,
  type NumberQuestion,
  type PracticeQuestion,
  type QuestionKind,
  type TextQuestion,
} from "../../../../../lib/team-lessons/types";
import { NumberField, TextField } from "./editor-fields";
import { moveItem, NO_ISSUES } from "./editor-steps";

const PASS_RULE = "With 4 questions or fewer, every answer has to be right to pass; with more, 80% passes.";

const ADD_LABEL: Record<QuestionKind, string> = {
  choice: "Add multiple choice",
  number: "Add a number question",
  text: "Add a short answer",
};

const KIND_LABEL: Record<QuestionKind, string> = {
  choice: "Multiple choice",
  number: "Number",
  text: "Short answer",
};

function blankQuestion(kind: QuestionKind): PracticeQuestion {
  const id = newContentId("q");
  if (kind === "choice") return { id, kind, prompt: "", options: ["", ""], answer: 0 };
  if (kind === "number") return { id, kind, prompt: "", answer: null, tolerance: 0 };
  return { id, kind, prompt: "", accepted: [""] };
}

type FieldsProps<Q> = { question: Q; onChange: (q: Q) => void; invalid: ReadonlySet<string> };

function ChoiceFields({ question, onChange, invalid }: FieldsProps<ChoiceQuestion>) {
  const group = useId();
  const field = `question:${question.id}:options`;
  const flagged = invalid.has(field);
  const seen = new Set<string>();
  return (
    <fieldset className="team-lesson-choice-edit" data-lesson-field={field}>
      <legend>Options — mark the correct one</legend>
      {question.options.map((option, index) => {
        const said = option.trim().toLowerCase();
        // Outline the empty option, or the second of two that say the same thing.
        const bad = flagged && (!said || seen.has(said));
        seen.add(said);
        return (
        <div key={index} className="team-lesson-choice-row">
          <label className="team-lesson-correct">
            <input
              type="radio"
              name={group}
              checked={question.answer === index}
              onChange={() => onChange({ ...question, answer: index })}
            />
            <span className="sr-only">Option {index + 1} is correct</span>
          </label>
          <input
            className="team-lesson-input"
            type="text"
            aria-label={`Option ${index + 1}`}
            maxLength={LESSON_LIMITS.option}
            value={option}
            placeholder={`Option ${index + 1}`}
            aria-invalid={bad ? true : undefined}
            onChange={(event) =>
              onChange({ ...question, options: question.options.map((entry, at) => (at === index ? event.target.value : entry)) })
            }
          />
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Remove option ${index + 1}`}
            disabled={question.options.length <= LESSON_LIMITS.optionsMin}
            onClick={() => {
              const options = question.options.filter((_, at) => at !== index);
              const answer = question.answer === index ? 0 : question.answer > index ? question.answer - 1 : question.answer;
              onChange({ ...question, options, answer });
            }}
          >
            ✕
          </Button>
        </div>
        );
      })}
      <Button
        variant="ghost"
        size="sm"
        disabled={question.options.length >= LESSON_LIMITS.optionsMax}
        onClick={() => onChange({ ...question, options: [...question.options, ""] })}
      >
        Add an option
      </Button>
    </fieldset>
  );
}

function NumberFields({ question, onChange, invalid }: FieldsProps<NumberQuestion>) {
  const field = `question:${question.id}:answer`;
  return (
    <div className="team-lesson-number-edit">
      <NumberField
        label="Correct answer"
        value={question.answer}
        onChange={(answer) => onChange({ ...question, answer })}
        suffix={question.unit}
        fieldKey={field}
        invalid={invalid.has(field)}
      />
      <NumberField
        label="Accept answers within ±"
        value={question.tolerance}
        min={0}
        hint="Use 0 or a positive number."
        onChange={(tolerance) => onChange({ ...question, tolerance: tolerance ?? 0 })}
        suffix={question.unit}
      />
      <TextField
        label="Unit"
        optional
        value={question.unit ?? ""}
        maxLength={LESSON_LIMITS.unit}
        placeholder="in, lb, V, rpm"
        onChange={(unit) => onChange({ ...question, unit })}
      />
    </div>
  );
}

function TextFields({ question, onChange, invalid }: FieldsProps<TextQuestion>) {
  const field = `question:${question.id}:accepted`;
  return (
    <fieldset className="team-lesson-choice-edit" data-lesson-field={field}>
      <legend>Accepted answers — capital letters and extra spaces don&apos;t matter</legend>
      {question.accepted.map((entry, index) => (
        <div key={index} className="team-lesson-choice-row">
          <input
            className="team-lesson-input"
            type="text"
            aria-label={`Accepted answer ${index + 1}`}
            maxLength={LESSON_LIMITS.acceptedText}
            value={entry}
            aria-invalid={invalid.has(field) && !entry.trim() ? true : undefined}
            onChange={(event) =>
              onChange({ ...question, accepted: question.accepted.map((value, at) => (at === index ? event.target.value : value)) })
            }
          />
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Remove accepted answer ${index + 1}`}
            disabled={question.accepted.length <= 1}
            onClick={() => onChange({ ...question, accepted: question.accepted.filter((_, at) => at !== index) })}
          >
            ✕
          </Button>
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        disabled={question.accepted.length >= LESSON_LIMITS.accepted}
        onClick={() => onChange({ ...question, accepted: [...question.accepted, ""] })}
      >
        Add another accepted answer
      </Button>
    </fieldset>
  );
}

export function PracticeEditor({
  questions,
  onChange,
  invalid = NO_ISSUES,
}: {
  questions: PracticeQuestion[];
  onChange: (questions: PracticeQuestion[]) => void;
  /** Fields listed under "Finish these before publishing" (lessonPublishIssues keys). */
  invalid?: ReadonlySet<string>;
}) {
  const full = questions.length >= LESSON_LIMITS.questions;

  async function remove(index: number) {
    const question = questions[index];
    if (!question) return;
    const ok = await askConfirm({
      title: `Remove question ${index + 1}?`,
      body: question.prompt.trim() ? `“${question.prompt.trim().slice(0, 120)}” and its answer go with it.` : "It has no question written yet.",
      confirmLabel: "Remove question",
    });
    if (ok) onChange(questions.filter((_, at) => at !== index));
  }

  const set = (index: number, next: PracticeQuestion) => onChange(questions.map((entry, at) => (at === index ? next : entry)));

  return (
    <section className="team-lesson-edit-section" aria-labelledby="team-lesson-practice-edit-title">
      <h2 id="team-lesson-practice-edit-title">Practice questions</h2>
      <p className="app-muted">
        Vantage checks the answers when a student presses “Check my answers”.{" "}
        {questions.length ? passRuleSentence(questions.length) : PASS_RULE}
      </p>
      {questions.length ? (
        <ol className="team-lesson-edit-list">
          {questions.map((question, index) => (
            <li key={question.id} className="team-lesson-edit-card" aria-label={`Question ${index + 1}`} data-lesson-field={`question:${question.id}`}>
              <div className="team-lesson-edit-card-head">
                <strong>
                  Question {index + 1} · {KIND_LABEL[question.kind]}
                </strong>
                <div className="team-lesson-edit-card-tools">
                  <Button variant="ghost" size="sm" aria-label={`Move question ${index + 1} up`} disabled={index === 0} onClick={() => onChange(moveItem(questions, index, index - 1))}>
                    ↑
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Move question ${index + 1} down`}
                    disabled={index === questions.length - 1}
                    onClick={() => onChange(moveItem(questions, index, index + 1))}
                  >
                    ↓
                  </Button>
                  <Button variant="ghost" size="sm" aria-label={`Remove question ${index + 1}`} onClick={() => void remove(index)}>
                    Remove
                  </Button>
                </div>
              </div>
              <TextField
                label="Question"
                multiline
                value={question.prompt}
                maxLength={LESSON_LIMITS.prompt}
                fieldKey={`question:${question.id}:prompt`}
                invalid={invalid.has(`question:${question.id}:prompt`)}
                onChange={(prompt) => set(index, { ...question, prompt })}
              />
              {question.kind === "choice" ? (
                <ChoiceFields question={question} invalid={invalid} onChange={(next) => set(index, next)} />
              ) : question.kind === "number" ? (
                <NumberFields question={question} invalid={invalid} onChange={(next) => set(index, next)} />
              ) : (
                <TextFields question={question} invalid={invalid} onChange={(next) => set(index, next)} />
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p className="team-lesson-hint">No practice yet. Add a question to finish the lesson with a check.</p>
      )}
      <div className="team-lesson-actions">
        {(["choice", "number", "text"] as const).map((kind) => (
          <Button key={kind} variant="secondary" disabled={full} onClick={() => onChange([...questions, blankQuestion(kind)])}>
            {ADD_LABEL[kind]}
          </Button>
        ))}
        {full ? <span className="app-muted">A lesson can have up to {LESSON_LIMITS.questions} questions.</span> : null}
      </div>
    </section>
  );
}
