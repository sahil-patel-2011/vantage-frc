"use client";

import { useState } from "react";
import { askConfirm, Button } from "../../../../../components/ui";
import { newContentId } from "../../../../../lib/team-lessons/body";
import { LESSON_LIMITS, type LessonStep } from "../../../../../lib/team-lessons/types";
import { StepView } from "../../lesson-shared";
import { MarkdownField, TextField } from "./editor-fields";

export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length || from === to) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

function StepCard({
  step,
  index,
  count,
  onChange,
  onMove,
  onRemove,
}: {
  step: LessonStep;
  index: number;
  count: number;
  onChange: (step: LessonStep) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  const [preview, setPreview] = useState(false);
  const name = step.title.trim() || `Step ${index + 1}`;
  return (
    <li className="team-lesson-edit-card" aria-label={`Step ${index + 1}`}>
      <div className="team-lesson-edit-card-head">
        <strong>Step {index + 1}</strong>
        <div className="team-lesson-edit-card-tools">
          <button type="button" className="team-lesson-toggle" aria-pressed={preview} onClick={() => setPreview((on) => !on)}>
            {preview ? "Edit" : "Preview step"}
          </button>
          <Button variant="ghost" size="sm" aria-label={`Move ${name} up`} disabled={index === 0} onClick={() => onMove(index - 1)}>
            ↑
          </Button>
          <Button variant="ghost" size="sm" aria-label={`Move ${name} down`} disabled={index === count - 1} onClick={() => onMove(index + 1)}>
            ↓
          </Button>
          <Button variant="ghost" size="sm" aria-label={`Remove ${name}`} onClick={onRemove}>
            Remove
          </Button>
        </div>
      </div>
      {preview ? (
        <StepView step={step} number={index + 1} total={count} />
      ) : (
        <>
          <TextField
            label="Step title"
            value={step.title}
            maxLength={LESSON_LIMITS.stepTitle}
            placeholder="Say what this step does, e.g. Image the roboRIO"
            onChange={(title) => onChange({ ...step, title })}
          />
          <MarkdownField
            label="Text"
            value={step.text}
            maxLength={LESSON_LIMITS.stepText}
            rows={8}
            placeholder="Explain the step. One idea at a time."
            onChange={(text) => onChange({ ...step, text })}
          />
          <MarkdownField
            label="When to use it"
            optional
            value={step.whenToUse ?? ""}
            maxLength={LESSON_LIMITS.stepWhenToUse}
            rows={2}
            placeholder="The situation where this step matters."
            onChange={(whenToUse) => onChange({ ...step, whenToUse })}
          />
          <MarkdownField
            label="Example"
            optional
            value={step.example ?? ""}
            maxLength={LESSON_LIMITS.stepExample}
            rows={4}
            placeholder="A worked example, a command or a photo link."
            onChange={(example) => onChange({ ...step, example })}
          />
        </>
      )}
    </li>
  );
}

export function StepsEditor({ steps, onChange }: { steps: LessonStep[]; onChange: (steps: LessonStep[]) => void }) {
  const full = steps.length >= LESSON_LIMITS.steps;

  async function remove(index: number) {
    const step = steps[index];
    if (!step) return;
    const name = step.title.trim() || `Step ${index + 1}`;
    const written = step.text.trim() || step.example?.trim() || step.whenToUse?.trim();
    const ok = await askConfirm({
      title: `Remove “${name}”?`,
      body: written
        ? "Its text, example and “when to use it” go with it. An earlier version stays in History if you need it back."
        : "It has nothing written in it yet.",
      confirmLabel: "Remove step",
    });
    if (!ok) return;
    onChange(steps.filter((_, at) => at !== index));
  }

  return (
    <section className="team-lesson-edit-section" aria-labelledby="team-lesson-steps-title">
      <h2 id="team-lesson-steps-title">Steps</h2>
      <p className="app-muted">Students see one step at a time, with Back and Next. Keep each step to one idea.</p>
      {steps.length ? (
        <ol className="team-lesson-edit-list">
          {steps.map((step, index) => (
            <StepCard
              key={step.id}
              step={step}
              index={index}
              count={steps.length}
              onChange={(next) => onChange(steps.map((entry, at) => (at === index ? next : entry)))}
              onMove={(to) => onChange(moveItem(steps, index, to))}
              onRemove={() => void remove(index)}
            />
          ))}
        </ol>
      ) : (
        <p className="team-lesson-hint">No steps yet. Add the first one below.</p>
      )}
      <div className="team-lesson-actions">
        <Button
          variant="secondary"
          disabled={full}
          onClick={() => onChange([...steps, { id: newContentId("s"), title: "", text: "" }])}
        >
          Add a step
        </Button>
        {full ? <span className="app-muted">A lesson can have up to {LESSON_LIMITS.steps} steps.</span> : null}
      </div>
    </section>
  );
}
