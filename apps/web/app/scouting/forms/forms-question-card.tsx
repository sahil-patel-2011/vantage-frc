"use client";

import type { FieldDefinition, FormResetBehavior } from "@vantage/scouting";
import type { VisibleWhen } from "@vantage/scouting/visibility";
import { ActionMenu, FormRow } from "../../../components/ui";
import type { useTierDrag } from "../../../components/ui/use-tier-drag";
import {
  ANSWER_KIND_GROUPS,
  ANSWER_KIND_OPTIONS,
  RESET_BEHAVIOR_OPTIONS,
  STRATEGY_ROLE_OPTIONS,
  detectedRoleForQuestion,
  needsOptionEditor,
  needsSettingsEditor,
  type AnswerKind,
  type DraftQuestion,
  type StrategyFieldRole,
} from "../../../lib/scouting/form-builder";
import { OptionEditor } from "./forms-option-editor";
import { StudioSettingsEditor } from "./forms-settings-editor";
import { CollectionSettings } from "./forms-collection-settings";
import { FormsVisibilityEditor } from "./forms-visibility-editor";
import { FormsOfficialComparison } from "./forms-official-comparison";

type DragHandleProps = ReturnType<ReturnType<typeof useTierDrag<"questions">>["handleProps"]>;

/**
 * One question in the form editor: the row that opens it (with its reorder
 * handle and overflow actions) and, while it is open, everything about it.
 * The form owns the question list; this card only reports what changed.
 */
export function FormQuestionCard({
  question,
  index,
  fields,
  expanded,
  dragging,
  canManage,
  busy,
  canRemove,
  isMatch,
  dragHandleProps,
  onSelect,
  onDuplicate,
  onRemove,
  onUpdate,
  onRetype,
  onVisibleWhen,
}: {
  question: DraftQuestion;
  index: number;
  /** The draft as it would publish, so conditions and official checks use stable keys. */
  fields: FieldDefinition[];
  expanded: boolean;
  dragging: boolean;
  canManage: boolean;
  busy: boolean;
  canRemove: boolean;
  isMatch: boolean;
  dragHandleProps: DragHandleProps;
  onSelect: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onUpdate: (patch: Partial<DraftQuestion>) => void;
  onRetype: (kind: AnswerKind) => void;
  onVisibleWhen: (rule: VisibleWhen | null) => void;
}) {
  const locked = !canManage || busy;
  const field = fields[index]!;
  return (
    <article
      className={`sfb-question${dragging ? " is-dragging" : ""}`}
      data-entry-id={question.id}
      data-expanded={expanded}
    >
      <div className="sfb-question-head">
        <button type="button" className="sfb-question-select"
          aria-expanded={expanded}
          aria-controls={`question-editor-${question.id}`}
          onClick={onSelect}>
          <span className="sfb-question-number" aria-hidden="true">{index + 1}</span>
          <span><strong>{question.label || "Untitled question"}</strong><small>{ANSWER_KIND_OPTIONS.find(option => option.kind === question.kind)?.label}{question.required ? " · Required" : " · Optional"}</small></span>
        </button>
        {/* The whole row opens the question (no separate chevron); the handle reorders by drag or
            arrow keys, and Duplicate and Remove sit behind More, where Remove asks first. */}
        <div className="sfb-question-actions">
          {canManage ? (
            <button
              type="button"
              className="tier-drag-handle"
              aria-label={`Move question ${index + 1}: drag, or press the up and down arrow keys`}
              aria-disabled={busy || undefined}
              {...dragHandleProps}
            >
              <span aria-hidden="true">⋮⋮</span>
            </button>
          ) : null}
          <ActionMenu
            tone="row"
            overflowOnly
            label={`Question ${index + 1} actions`}
            maxSecondary={0}
            triggerTestId={`sfb-question-more:${question.id}`}
            actions={[
              {
                id: "duplicate",
                label: "Duplicate",
                intent: "normal",
                disabled: locked,
                hint: "A copy directly below, ready to edit",
                onClick: onDuplicate,
              },
              {
                id: "remove",
                label: "Remove",
                intent: "destructive",
                disabled: locked || !canRemove,
                hint: "Undo is offered right after",
                onClick: onRemove,
              },
            ]}
          />
        </div>
      </div>
      <div id={`question-editor-${question.id}`} className="sfb-question-editor" hidden={!expanded}>
      {expanded ? <>
      <div className="sfb-question-grid">
        <FormRow label="Label">
          <input
            value={question.label}
            disabled={locked}
            onChange={(event) => onUpdate({ label: event.target.value })}
            placeholder="What should scouts answer?"
          />
        </FormRow>
        <FormRow label="Answer type" hint={ANSWER_KIND_OPTIONS.find((o) => o.kind === question.kind)?.hint}>
          <select
            value={question.kind}
            disabled={locked}
            onChange={(event) => onRetype(event.target.value as AnswerKind)}
          >
            {/* Grouped the way people look for a type; on a phone this is the native picker. */}
            {ANSWER_KIND_GROUPS.map((group) => (
              <optgroup key={group} label={group}>
                {ANSWER_KIND_OPTIONS.filter((option) => option.group === group).map((option) => (
                  <option key={option.kind} value={option.kind}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </FormRow>
      </div>
      {/* Required sits with the question itself, not under the folded advanced options. */}
      {question.kind !== "section" ? (
        <label className={`sfb-check sfb-required-toggle${question.required ? " is-on" : ""}`}>
          <input
            type="checkbox"
            role="switch"
            checked={question.required}
            disabled={locked}
            onChange={(event) => onUpdate({ required: event.target.checked })}
          />
          <span>
            <strong>Required</strong>
            <small className="app-muted">
              {question.required ? "Scouts must answer before they save" : "Scouts can skip it"}
            </small>
          </span>
        </label>
      ) : null}
      {needsOptionEditor(question.kind) ? (
        <OptionEditor
          optionsText={question.optionsText}
          disabled={locked}
          kind={question.kind}
          onChange={(optionsText) => onUpdate({ optionsText })}
        />
      ) : null}
      {needsSettingsEditor(question.kind) ? (
        <StudioSettingsEditor
          question={question}
          disabled={locked}
          onChange={(settings) => onUpdate({ settings })}
        />
      ) : null}
      {question.kind === "section" ? (
        <p className="app-muted" style={{ margin: 0, fontSize: 13 }}>
          Layout only — this heading groups every question under it until the next
          section, and it stores no answer.
        </p>
      ) : (
        <>
          {/* The settings most forms never change, folded: every question showed all of them. */}
          <details className="sfb-more">
            <summary data-disclosure>Description, chart and more</summary>
            <CollectionSettings question={question} index={index} match={isMatch} disabled={locked} onChange={collectionConfig => onUpdate({ collectionConfig })} />
            <FormsVisibilityEditor rule={question.visibleWhen} fieldKey={field.key} fields={fields} disabled={locked} onChange={onVisibleWhen} />
            <FormRow label="Description"><input value={question.helpText ?? ""} disabled={locked} onChange={event => onUpdate({ helpText: event.target.value })} placeholder="Optional guidance for scouts" /></FormRow>
            <FormRow label="Chart on Responses"><select aria-label={`Chart for question ${index+1}`} value={question.chart ?? "auto"} disabled={locked} onChange={event => onUpdate({ chart: event.target.value as DraftQuestion["chart"] })}><option value="auto">Automatic</option><option value="bar">Answer counts</option><option value="trend">Number trend</option><option value="none">Table only</option></select></FormRow>
            <FormRow
              label="Used in strategy as"
              hint={
                question.role === "none"
                  ? detectedRoleForQuestion(question) !== "none"
                    ? `Detected: ${
                        STRATEGY_ROLE_OPTIONS.find(
                          (option) => option.role === detectedRoleForQuestion(question),
                        )?.label ?? detectedRoleForQuestion(question)
                      }`
                    : "Not mapped — pick a role so answers reach strategy and pick tools"
                  : STRATEGY_ROLE_OPTIONS.find((option) => option.role === question.role)
                      ?.hint
              }
            >
              <select
                value={question.role}
                disabled={locked}
                aria-label={`Strategy mapping for question ${index + 1}`}
                onChange={(event) =>
                  onUpdate({
                    role: event.target.value as StrategyFieldRole,
                  })
                }
              >
                {STRATEGY_ROLE_OPTIONS.map((option) => (
                  <option key={option.role} value={option.role}>
                    {option.label}
                  </option>
                ))}
              </select>
            </FormRow>
            {isMatch ? <FormsOfficialComparison question={question} field={field} index={index}
              disabled={locked}
              onChange={officialComparison => onUpdate({ officialComparison })} /> : null}
          <FormRow
            label="For the next match"
            hint={
              RESET_BEHAVIOR_OPTIONS.find(
                (option) => option.behavior === question.reset,
              )?.hint
            }
          >
            <select
              value={question.reset}
              disabled={locked}
              aria-label={`After-save behavior for question ${index + 1}`}
              onChange={(event) =>
                onUpdate({
                  reset: event.target.value as FormResetBehavior,
                })
              }
            >
              {RESET_BEHAVIOR_OPTIONS.map((option) => (
                <option key={option.behavior} value={option.behavior}>
                  {option.label}
                </option>
              ))}
            </select>
          </FormRow>
          </details>
        </>
      )}
      </> : null}
      </div>
    </article>
  );
}
