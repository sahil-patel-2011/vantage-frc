"use client";

import type { FieldDefinition, MatchCapture } from "@vantage/scouting";
import { captureSummary } from "@vantage/scouting";
import {
  QUICK_STAGE_LABELS,
  answerText,
  fieldsForQuickStage,
  quickFieldStages,
  quickTileKind,
  uncountedFields,
  type QuickStage,
} from "../../../lib/scouting/quick-scout";
import { QuickTile } from "./quick-scout-tiles";

const CONFIDENCE: Array<{ value: "high" | "normal" | "low"; label: string }> = [
  { value: "high", label: "Sure" },
  { value: "normal", label: "Mostly" },
  { value: "low", label: "Guessing" },
];

const ACTION_WORDS: Record<string, string> = {
  shooting: "Shooting",
  feeding: "Feeding",
  defending: "Defense",
  disabled: "Stopped",
};

/**
 * After the buzzer: the questions only a person can answer, a check of every count, and
 * Save. Blank counts the form wanted watched are called out, with a one-tap zero, so
 * "did not see" and "saw none" never get mixed up.
 */
export function QuickScoutReview({
  orgId,
  fields,
  payload,
  confidence,
  issues,
  saving,
  capture,
  fullFormHref,
  onAnswer,
  onStep,
  onConfidence,
  onJump,
  onSave,
}: {
  orgId: string;
  fields: FieldDefinition[];
  payload: Record<string, unknown>;
  confidence: "high" | "normal" | "low";
  issues: string[];
  saving: boolean;
  capture: MatchCapture | null;
  fullFormHref: string;
  onAnswer(key: string, value: unknown): void;
  onStep(key: string, delta: number): void;
  onConfidence(value: "high" | "normal" | "low"): void;
  onJump(stage: QuickStage): void;
  onSave(): void;
}) {
  const questions = fieldsForQuickStage(fields, "review");
  const blank = uncountedFields(fields, payload);
  const stages = quickFieldStages(fields);
  const recorded = fields.filter((field) => stages.get(field.key) !== "review");
  const actions = capture ? captureSummary(capture) : null;
  const invalid = new Set(fields.filter((field) => issues.some((issue) => issue.startsWith(field.label))).map((field) => field.key));

  return (
    <div className="qs-review">
      {questions.length ? (
        <section className="qs-section" aria-labelledby="qs-review-questions">
          <h2 id="qs-review-questions">How did it go?</h2>
          <p className="qs-fineprint">Only what happened in this match, not what you have seen before.</p>
          <div className="qs-grid is-review">
            {questions.map((field) => (
              <QuickTile
                key={field.key}
                field={field}
                value={payload[field.key]}
                orgId={orgId}
                invalid={invalid.has(field.key)}
                onChange={(value) => onAnswer(field.key, value)}
                onStep={(delta) => onStep(field.key, delta)}
              />
            ))}
          </div>
        </section>
      ) : null}

      <section className="qs-section" aria-labelledby="qs-confidence">
        <h2 id="qs-confidence">How sure are you?</h2>
        <div className="qs-segmented" role="radiogroup" aria-labelledby="qs-confidence">
          {CONFIDENCE.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={confidence === option.value}
              className={confidence === option.value ? "is-on" : undefined}
              onClick={() => onConfidence(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      {blank.length ? (
        <section className="qs-section qs-uncounted" aria-labelledby="qs-uncounted">
          <h2 id="qs-uncounted">Not counted</h2>
          <p className="qs-fineprint">Leave these blank if you could not see. If you watched and nothing happened, mark zero.</p>
          <ul className="qs-list">
            {blank.map((field) => (
              <li key={field.key} className="qs-uncounted-row">
                <span>{field.label}</span>
                <button type="button" className="qs-chip" onClick={() => onAnswer(field.key, 0)}>
                  Saw none · 0
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {recorded.length || actions ? (
        <details className="qs-section qs-summary">
          <summary>Check what you recorded</summary>
          <ul className="qs-list">
            {recorded.map((field) => {
              const stage = stages.get(field.key) ?? "teleop";
              return (
                <li key={field.key}>
                  <button type="button" className="qs-summary-row" onClick={() => onJump(stage)}>
                    <span>
                      {field.label}
                      <small>{QUICK_STAGE_LABELS[stage]}</small>
                    </span>
                    <strong>{answerText(field, payload[field.key])}</strong>
                  </button>
                </li>
              );
            })}
            {actions
              ? Object.entries(actions)
                  .filter(([, metric]) => metric.bouts > 0)
                  .map(([kind, metric]) => (
                    <li key={kind} className="qs-summary-row is-static">
                      <span>
                        {ACTION_WORDS[kind] ?? kind}
                        <small>Timed</small>
                      </span>
                      <strong>{Math.round(metric.seconds)}s · {metric.bouts}×</strong>
                    </li>
                  ))
              : null}
          </ul>
        </details>
      ) : null}


      {issues.length ? (
        <div className="qs-issues" role="alert">
          <strong>Before you save</strong>
          <ul>
            {issues.slice(0, 6).map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="qs-save-bar">
        <a className="qs-link" href={fullFormHref}>
          Open the full form
        </a>
        <button type="button" className="qs-primary qs-save" onClick={onSave} disabled={saving}>
          {saving ? "Saving…" : "Save match"}
        </button>
      </div>
      {fields.some((field) => quickTileKind(field) === "detail" && field.required && stages.get(field.key) !== "review") ? (
        <p className="qs-fineprint">Some required questions are on the earlier stages; tap a stage above to answer them.</p>
      ) : null}
    </div>
  );
}
