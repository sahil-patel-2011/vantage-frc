"use client";

import type { FieldDefinition } from "@vantage/scouting";
import { isVisibleWhen, type VisibleWhen, type VisibleWhenClause } from "@vantage/scouting/visibility";
import { FormRow } from "../../../components/ui";

export function FormsVisibilityEditor({ rule, fieldKey, fields, disabled, onChange }: {
  rule?: VisibleWhen | null; fieldKey: string; fields: FieldDefinition[]; disabled: boolean;
  onChange: (rule: VisibleWhen | null) => void;
}) {
  const tests = rule && "fieldKey" in rule ? Object.keys(rule).filter(key => key !== "fieldKey") : [];
  const simple = rule && isVisibleWhen(rule) && "fieldKey" in rule && tests.length === 1 && ["isSet", "isTrue", "equals", "notEquals", "gte", "lte"].includes(tests[0]!) ? rule : null;
  const advanced = Boolean(rule && !simple);
  const watched = fields.find(field => field.key === simple?.fieldKey);
  const controllers = fields.filter(field => field.key !== fieldKey && field.type !== "section_header");
  const operation = simple ? "isSet" in simple ? simple.isSet ? "answered" : "unanswered" : "gte" in simple ? "gte" : "lte" in simple ? "lte" : "notEquals" in simple ? "notEquals" : "equals" : "answered";
  const value = simple?.isTrue ?? simple?.equals ?? simple?.notEquals ?? simple?.gte ?? simple?.lte ?? "";
  const numeric = Boolean(watched && ["number", "counter", "rating", "slider", "timer"].includes(watched.type));
  const setComparison = (op: string, answer: unknown) => {
    if (!simple) return;
    const base = { fieldKey: simple.fieldKey };
    onChange(op === "answered" || op === "unanswered" ? { ...base, isSet: op === "answered" } : { ...base, [op]: answer } as VisibleWhenClause);
  };
  const initialValue = watched?.type === "boolean" ? true : numeric ? 0 : watched?.options?.[0] ?? "";
  return <div className="sfb-visibility-editor">
    <FormRow label="Show this question" hint="A conditional question appears only when the answer below matches.">
      <select aria-label={`Visibility for ${fields.find(field => field.key === fieldKey)?.label ?? "question"}`} disabled={disabled} value={advanced ? "__advanced" : simple?.fieldKey ?? ""} onChange={event => onChange(event.target.value ? { fieldKey: event.target.value, isSet: true } : null)}>
        <option value="">{fields.some(field => field.key === "gamePhase" || field.key === "game_phase") ? "Follow the form’s phase rules" : "Always"}</option>
        {advanced ? <option value="__advanced" disabled>Existing advanced condition (preserved)</option> : null}
        {simple && !watched ? <option value={simple.fieldKey} disabled>Missing question — choose a replacement</option> : null}
        {controllers.map(field => <option key={field.key} value={field.key}>When: {field.label}</option>)}
      </select>
    </FormRow>
    {simple && watched ? <>
      <FormRow label="Answer condition"><select aria-label="Answer condition" disabled={disabled} value={operation} onChange={event => setComparison(event.target.value, initialValue)}>
        <option value="answered">Has an answer</option><option value="unanswered">Has no answer</option><option value="equals">Is</option><option value="notEquals">Is not</option>
        {numeric ? <><option value="gte">Is at least</option><option value="lte">Is at most</option></> : null}
      </select></FormRow>
      {operation !== "answered" && operation !== "unanswered" ? <FormRow label="Matching answer">
        {watched.type === "boolean" ? <select aria-label="Matching answer" disabled={disabled} value={String(value)} onChange={event => setComparison(operation, event.target.value === "true")}><option value="true">Yes</option><option value="false">No</option></select>
          : watched.options?.length ? <select aria-label="Matching answer" disabled={disabled} value={String(value)} onChange={event => setComparison(operation, event.target.value)}><option value="" disabled>Choose answer</option>{watched.options.map(option => <option key={option} value={option}>{option}</option>)}</select>
          : <input aria-label="Matching answer" disabled={disabled} type={numeric ? "number" : "text"} value={String(value)} onChange={event => { if (!numeric || event.target.value !== "") setComparison(operation, numeric ? Number(event.target.value) : event.target.value); }} />}
      </FormRow> : null}
    </> : null}
    {advanced ? <p className="app-muted">This form has a combined condition. It will be kept through edits and publication. Choosing another question replaces that condition.</p> : null}
  </div>;
}
