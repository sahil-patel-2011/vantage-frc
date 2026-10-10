"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { evaluateObservedFormula, isFormulaExpression, isFormulaDraftExpression, isUnseenFormulaAnswer, formulaFields, type FormulaExpression, type FieldDefinition, type ScoutSchema } from "@vantage/scouting";
import { Button, FormRow, Modal } from "../../../components/ui";
import { apiErrorMessage } from "../../../lib/ui/load-failure";
import { defaultFormulaTerm, formulaDraftKey, formulaInputError, formulaOptions, latestFormulaDraft, formulaForRole, SCORING_ROLE_NAMES, NUMERIC_FORMULA_TYPES, CHOICE_FORMULA_TYPES, type SavedFormula } from "../../../lib/scouting/formula-editor";
import { scoutOptionLabel } from "../../../lib/scouting/option-label";

const ROLES = Object.keys(SCORING_ROLE_NAMES) as Array<keyof typeof SCORING_ROLE_NAMES>;
const OPS = { field: "Numeric answer", lookup: "Points per answer", constant: "Fixed amount", add: "Add", subtract: "Subtract", multiply: "Multiply", divide: "Divide", min: "Minimum", max: "Maximum" };

function FormulaNode({ node, fields, disabled, onChange, depth = 0 }: {
  node: FormulaExpression; fields: FieldDefinition[]; disabled: boolean; onChange: (value: FormulaExpression) => void; depth?: number;
}) {
  const numeric = fields.filter(field => NUMERIC_FORMULA_TYPES.has(field.type));
  const choices = fields.filter(field => CHOICE_FORMULA_TYPES.has(field.type));
  const setKind = (op: FormulaExpression["op"]) => {
    if (op === "field") onChange(defaultFormulaTerm(fields));
    else if (op === "constant") onChange({ op, value: NaN });
    else if (op === "lookup" && choices[0]) onChange({ op, field: choices[0].key, values: {} });
    else if (["add", "subtract", "multiply", "divide", "min", "max"].includes(op)) onChange({ op: op as "add", args: "args" in node ? node.args : [node] });
  };
  const field = "field" in node ? fields.find(field => field.key === node.field) : undefined;
  const linear = node.op === "multiply" && node.args.length === 2 && node.args[0]?.op === "field" && node.args[1]?.op === "constant" ? { field: node.args[0], weight: node.args[1] } : null;
  return <fieldset className="sfm-term" disabled={disabled}>
    <legend className="sr-only">Scoring term, level {depth + 1}</legend>
    <label>Calculation<select value={node.op} onChange={event => setKind(event.target.value as FormulaExpression["op"])}>
      {Object.entries(OPS).map(([op, label]) => <option key={op} value={op} disabled={(op === "field" && !numeric.length) || (op === "lookup" && !choices.length) || (depth >= 10 && !["field", "lookup", "constant"].includes(op))}>{label}</option>)}
    </select></label>
    {node.op === "constant" ? <label>Amount<input type="number" step="any" value={Number.isFinite(node.value) ? node.value : ""} onChange={event => onChange({ ...node, value: event.target.valueAsNumber })} /></label> : null}
    {node.op === "field" || node.op === "lookup" ? <>
      <label>Published question<select value={node.field} onChange={event => onChange(node.op === "lookup" ? { ...node, field: event.target.value, values: {} } : { ...node, field: event.target.value })}>
        {!field ? <option value={node.field}>Unavailable question: {node.field}</option> : null}
        {(node.op === "field" ? numeric : choices).map(field => <option key={field.key} value={field.key}>{field.label}</option>)}
      </select></label>
      {node.op === "lookup" && field ? <div className="sfm-mapping"><p>Leave an answer unmapped if it cannot establish a score. Recorded zero is valid.</p>
        {formulaOptions(field).map(option => <label key={option}>{scoutOptionLabel(option)}{isUnseenFormulaAnswer(option) ? <span>Remains unknown{Object.hasOwn(node.values, option) ? <Button type="button" variant="ghost" onClick={() => { const values = { ...node.values }; delete values[option]; onChange({ ...node, values }); }}>Remove old mapping</Button> : null}</span> : <input type="number" step="any" placeholder="Unknown" value={Number.isFinite(node.values[option]) ? node.values[option] : ""} onChange={event => {
          const next = { ...node.values };
          if (event.target.value === "") delete next[option]; else next[option] = event.target.valueAsNumber;
          onChange({ ...node, values: next });
        }} />}</label>)}
      </div> : null}
    </> : null}
    {linear ? <>
      <label>Published question<select value={linear.field.field} onChange={event => onChange({ op: "multiply", args: [{ op: "field", field: event.target.value }, linear.weight] })}>
        {!numeric.some(field => field.key === linear.field.field) ? <option value={linear.field.field}>Unavailable question: {linear.field.field}</option> : null}
        {numeric.map(field => <option key={field.key} value={field.key}>{field.label}</option>)}
      </select></label>
      <label>Points per recorded unit<input type="number" step="any" placeholder="Set a weight" value={Number.isFinite(linear.weight.value) ? linear.weight.value : ""} onChange={event => onChange({ op: "multiply", args: [linear.field, { op: "constant", value: event.target.valueAsNumber }] })} /></label>
    </> : "args" in node ? <div className="sfm-children">
      {node.args.map((child, index) => <div key={index} className="sfm-child">
        <FormulaNode node={child} fields={fields} disabled={disabled} depth={depth + 1} onChange={value => onChange({ ...node, args: node.args.map((child, at) => at === index ? value : child) })} />
        <Button type="button" variant="ghost" aria-label={`Remove scoring term ${index + 1} at level ${depth + 1}`} onClick={() => onChange({ ...node, args: node.args.filter((_, at) => at !== index) })}>Remove term</Button>
      </div>)}
      {node.args.length < 32 && depth < 10 ? <Button type="button" variant="secondary" onClick={() => { const term = defaultFormulaTerm(fields); onChange({ ...node, args: [...node.args, term.op === "field" ? { op: "multiply", args: [term, { op: "constant", value: NaN }] } : term] }); }}>Add scoring term</Button> : <p>The calculation has reached the nesting or term limit.</p>}
    </div> : null}
  </fieldset>;
}

export function ScoringFormulas({ open, onClose, orgId, userId, schema, canManage }: {
  open: boolean; onClose: () => void; orgId: string; userId?: string; schema?: ScoutSchema; canManage: boolean;
}) {
  const [formulas, setFormulas] = useState<SavedFormula[]>([]);
  const [name, setName] = useState("Total points");
  const [expression, setExpression] = useState<FormulaExpression>({ op: "add", args: [] });
  const [baseRevision, setBaseRevision] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const saveRef = useRef(false);
  const editorId = useRef<string | null>(null);
  const recoveredDraft = useRef<{ key: string; raw: string } | null>(null);
  const writtenDraft = useRef<{ key: string; raw: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [draftError, setDraftError] = useState("");
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [sample, setSample] = useState<Record<string, unknown>>({});
  const fields = schema?.definition.fields ?? [];
  const valid = isFormulaExpression(expression);
  const inputError = valid ? formulaInputError(expression, fields) : "Add scoring terms and fill every fixed amount. Unmapped answers remain unknown.";
  const preview = valid && !inputError ? evaluateObservedFormula(expression, sample) : null;
  const draftPrefix = userId ? formulaDraftKey(userId, orgId, name) : null;
  const baseline = formulas.find(formula => formula.name === name);
  const activeOptions = ROLES.map(role => ({ role, name: formulaForRole(formulas, role)?.name ?? role }));
  const isActive = activeOptions.some(option => option.name === name);
  const editable = canManage && isActive;
  const referencedKeys = useMemo(() => new Set(formulaFields(expression)), [expression]);
  const hasConflict = conflict || (dirty && (baseline?.revision ?? null) !== baseRevision);
  const change = (next: FormulaExpression) => { setExpression(next); setDirty(true); setConfirmDiscard(false); setMessage(""); };
  const loadFormula = (nextName: string, rows = formulas) => {
    const saved = rows.find(formula => formula.name === nextName);
    let recovery = null;
    try { if (userId) recovery = latestFormulaDraft(localStorage, formulaDraftKey(userId, orgId, nextName)); } catch { /* Keep live data available. */ }
    const recovered = recovery?.draft.name === nextName && canManage ? recovery.draft : null;
    recoveredDraft.current = recovered && recovery ? { key: recovery.key, raw: recovery.raw } : null;
    writtenDraft.current = null;
    setName(nextName); setExpression(recovered?.expression ?? (saved && isFormulaExpression(saved.expression) ? saved.expression : { op: "add", args: [] }));
    setBaseRevision(recovered ? recovered.baseRevision : saved?.revision ?? null);
    setDirty(Boolean(recovered)); setConflict(Boolean(recovered && recovered.baseRevision !== (saved?.revision ?? null)));
    setMessage(recovered ? "Your scoring draft was restored. It is not saved to the team yet." : saved && !isFormulaExpression(saved.expression) ? "The saved calculation is invalid. Add valid terms to repair it; the existing data stays unchanged until you save." : "");
    setDraftError(""); setConfirmDiscard(false); setSample({});
  };

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true); setLoadError("");
    void fetch(`/api/scouting/formulas?${new URLSearchParams({ orgId })}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) })
      .then(async response => {
        if (!response.ok) throw new Error((await apiErrorMessage(response)) ?? "Could not load scoring formulas.");
        const body = await response.json() as { formulas?: SavedFormula[] };
        if (!Array.isArray(body.formulas) || body.formulas.some(formula => typeof formula.id !== "string" || typeof formula.name !== "string" || typeof formula.revision !== "string")) throw new Error("Saved formulas could not be read. Existing data has been preserved.");
        if (controller.signal.aborted) return;
        setFormulas(body.formulas); setLoaded(true);
        if (!dirty) loadFormula(!loaded ? formulaForRole(body.formulas, "Total points")?.name ?? "Total points" : name, body.formulas);
      }).catch(error => { if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "Could not load scoring formulas."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
    // Opening or explicit refresh fetches once; typing never refetches formulas.
  }, [open, orgId, retry]);

  useEffect(() => {
    if (!dirty || !editable) return;
    if (!draftPrefix || !schema) { setDraftError("Draft storage needs your account and a published match form. Keep this editor open."); return; }
    try {
      if (!isFormulaDraftExpression(expression)) throw new Error("Draft exceeds expression limits");
      editorId.current ??= crypto.randomUUID();
      const draftStorageKey = `${draftPrefix}:${editorId.current}`;
      const raw = JSON.stringify({ name, expression, baseRevision, schemaId: schema.id, savedAt: new Date().toISOString() });
      if (raw.length > 100_000) throw new Error("Draft is too large");
      localStorage.setItem(draftStorageKey, raw); writtenDraft.current = { key: draftStorageKey, raw }; setDraftError("");
    } catch { setDraftError("Your draft could not be saved on this device. Keep the editor open or explicitly discard the draft."); }
  }, [dirty, editable, draftPrefix, schema?.id, name, expression, baseRevision]);

  useEffect(() => {
    if (!dirty || !draftError) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, draftError]);

  async function save() {
    if (saveRef.current || !editable || !loaded || loadError || !schema || inputError || hasConflict || !dirty) return;
    saveRef.current = true; setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/scouting/formulas", { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(15_000), body: JSON.stringify({ orgId, name, expression, schemaId: schema.id, baseRevision }) });
      if (!response.ok) { if (response.status === 409) { setConflict(true); setRetry(value => value + 1); } throw new Error((await apiErrorMessage(response)) ?? "Could not save the formula."); }
      const saved = await response.json() as SavedFormula;
      if (saved.name !== name || typeof saved.id !== "string" || typeof saved.revision !== "string" || !isFormulaExpression(saved.expression)) throw new Error("Save confirmation was incomplete. Refresh formulas before retrying; your draft remains saved.");
      setFormulas(rows => rows.some(row => row.name === saved.name) ? rows.map(row => row.name === saved.name ? saved : row) : [...rows, saved]);
      setExpression(saved.expression); setBaseRevision(saved.revision); setDirty(false); setConflict(false);
      setMessage("Scoring formula saved to your team. Reopen Teams to refresh its analysis.");
      try { clearOwnDrafts(); setDraftError(""); } catch { setDraftError("Saved to the team, but this device could not remove the older draft."); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Not saved. Your draft remains here."); }
    finally { saveRef.current = false; setSaving(false); }
  }

  function clearOwnDrafts() {
    for (const saved of [writtenDraft.current, recoveredDraft.current]) {
      if (saved && localStorage.getItem(saved.key) === saved.raw) localStorage.removeItem(saved.key);
    }
    writtenDraft.current = null; recoveredDraft.current = null;
  }

  function discard() {
    try { clearOwnDrafts(); } catch { setDraftError("Could not discard the saved draft. Your edits remain open."); return; }
    setExpression(baseline && isFormulaExpression(baseline.expression) ? baseline.expression : { op: "add", args: [] }); setBaseRevision(baseline?.revision ?? null);
    setDirty(false); setConflict(false); setConfirmDiscard(false); setDraftError(""); setMessage("Draft discarded. The team’s saved formula is unchanged.");
  }

  return <Modal open={open} onClose={() => { if (saving) return; if (dirty && draftError) { setMessage("The device draft is not saved. Fix storage or explicitly discard it before closing."); return; } onClose(); }} title="Scoring formulas" description="Turn recorded answers into points. Missing answers stay unknown." className="sfm-dialog">
    <div className="sfm-body">
      {!schema ? <p role="status">Publish a match form before configuring its scoring. Your form draft does not change live scoring.</p> : <p className="app-muted">Published {schema.definition.title}, version {schema.version}. Formula changes apply to your team’s reports with these question keys.</p>}
      {!canManage ? <p className="app-muted">You can view scoring. A scouting lead or team admin can change it.</p> : null}
      {loadError ? <div role="alert"><p>{loadError}</p><Button type="button" variant="secondary" onClick={() => setRetry(value => value + 1)}>Reload formulas</Button></div> : null}
      {loading ? <p role="status">Loading saved formulas…</p> : null}
      <FormRow label="Formula"><select value={name} disabled={loading || saving || Boolean(draftError && dirty)} onChange={event => loadFormula(event.target.value)}>
        {activeOptions.map(option => <option key={option.role} value={option.name}>{option.role}{option.name !== option.role ? ` · saved as ${option.name}` : ""}</option>)}
        {formulas.filter(formula => !activeOptions.some(option => option.name === formula.name)).map(formula => <option key={formula.id} value={formula.name}>{formula.name} · retained, inactive</option>)}
      </select></FormRow>
      <p className="app-muted">Use Total points for a full score, or Auto, Teleop and Endgame for phase scores. Weights and points per answer come from your team’s scoring rules.</p>
      {!isActive ? <p role="status">This older formula is retained for inspection. The active formulas above feed team analysis; choose one of those to change scoring.</p> : null}
      {hasConflict ? <section className="sfm-conflict" aria-label="Scoring conflict"><p role="alert">Another lead saved a different version. Your draft is retained.</p>
        <p>Latest saved formula: {baseline ? new Date(baseline.updatedAt).toLocaleString() : "Not found"}.</p>
        <details><summary>Review the latest calculation</summary>{baseline && isFormulaExpression(baseline.expression) ? <FormulaNode node={baseline.expression} fields={fields} disabled onChange={() => undefined} /> : <p>{baseline ? "The latest saved calculation is invalid. Its data is retained." : "No formula with this name is saved."}</p>}</details>
        <Button type="button" variant="secondary" disabled={loading || saving || Boolean(loadError)} onClick={() => { setBaseRevision(baseline?.revision ?? null); setConflict(false); setDirty(true); setMessage("Your draft now targets the reviewed version. Save when ready; calculations are not merged automatically."); }}>Keep my draft over this version</Button>
      </section> : null}
      {loaded && !loadError ? <FormulaNode node={expression} fields={fields} disabled={!editable || saving || loading || !schema} onChange={change} /> : null}
      {inputError && canManage ? <p role="status" className="app-muted">{inputError}</p> : null}
      <details className="sfm-preview"><summary>Try sample answers</summary><p className="app-muted">Only a calculation preview. No scouting reports are created or changed.</p>
        {fields.filter(field => referencedKeys.has(field.key)).filter(field => NUMERIC_FORMULA_TYPES.has(field.type) || CHOICE_FORMULA_TYPES.has(field.type)).map(field => <FormRow key={field.key} label={field.label}>
          {CHOICE_FORMULA_TYPES.has(field.type) ? <select value={sample[field.key] === undefined ? "" : String(sample[field.key])} onChange={event => setSample(current => ({ ...current, [field.key]: event.target.value === "" ? undefined : field.type === "boolean" ? event.target.value === "true" : event.target.value }))}><option value="">Not observed</option>{formulaOptions(field).map(option => <option key={option} value={option}>{scoutOptionLabel(option)}</option>)}</select>
            : <input type="number" step="any" placeholder="Not observed" value={typeof sample[field.key] === "number" && Number.isFinite(sample[field.key]) ? sample[field.key] as number : ""} onChange={event => setSample(current => ({ ...current, [field.key]: event.target.value === "" ? undefined : event.target.valueAsNumber }))} />}
        </FormRow>)}
        <p role="status"><strong>{preview === null ? "Unknown — required inputs are missing, unmapped or invalid." : `${preview.toFixed(2)} points`}</strong></p>
      </details>
      {draftError ? <p role="alert">{draftError}</p> : dirty ? <p className="app-muted">Draft saved on this device · not applied to the team.</p> : null}
      {message ? <p role="status">{message}</p> : null}
      {confirmDiscard ? <section className="sfm-conflict" aria-label="Discard scoring draft"><p>Discard your unsaved scoring changes? The team’s saved formula stays unchanged.</p><Button type="button" variant="secondary" disabled={saving} onClick={() => setConfirmDiscard(false)}>Keep editing</Button><Button type="button" variant="ghost" disabled={saving} onClick={discard}>Confirm discard</Button></section> : null}
    </div>
    <footer className="sfm-actions">
      {dirty && canManage && !confirmDiscard ? <Button type="button" variant="ghost" disabled={saving} onClick={() => setConfirmDiscard(true)}>Discard scoring draft</Button> : null}
      {editable ? <Button type="button" variant="primary" disabled={saving || loading || !loaded || Boolean(loadError) || !schema || Boolean(inputError) || hasConflict || !dirty} onClick={() => void save()}>{saving ? "Saving…" : dirty ? "Save scoring formula" : baseline ? "Saved" : "Add terms to configure scoring"}</Button> : null}
    </footer>
  </Modal>;
}
