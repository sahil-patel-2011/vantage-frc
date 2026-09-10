"use client";

import { useMemo, useState } from "react";
import {
  appendComposerOp,
  composerPalette,
  describeComposerOp,
  draftFromParameters,
  emptyComposerDraft,
  parametersFromDraft,
  parseComposerOps,
  removeComposerOp,
  replaceComposerOp,
  serializeComposerOps,
  summarizeComposerParams,
  type ComposerNativeOp,
  type ComposerOp,
} from "../../lib/cad/composer-ops";
import { type ListedOnshapeAssembly } from "../../lib/cad/list-assembly";
import { type ListedOnshapeEntities } from "../../lib/cad/list-entities";
import { rememberComposerFeature } from "../../lib/cad/remember-feature";
import { CadComposerFields } from "./cad-composer-fields";

export {
  COMPOSER_NATIVE_OPS,
  parseComposerOps,
  serializeComposerOps,
} from "../../lib/cad/composer-ops";

export function CadOperationComposer({
  platform,
  disabled = false,
  plan,
  onPlanChange,
  onAppend,
  onRunPlan,
  entities,
  features,
  instances,
}: {
  platform: string;
  disabled?: boolean;
  plan?: ComposerOp[] | unknown;
  onPlanChange?: (ops: ComposerOp[]) => void;
  onAppend?: (payload: Record<string, unknown>) => Promise<unknown>;
  onRunPlan?: (plan: unknown) => Promise<{ ok?: boolean; error?: string } | void>;
  entities?: ListedOnshapeEntities;
  features?: ReadonlyArray<{ featureId: string }>;
  instances?: ListedOnshapeAssembly["instances"];
}) {
  const operations = useMemo(() => composerPalette(platform), [platform]);
  const [operation, setOperation] = useState<ComposerNativeOp>(operations[0] ?? "create_sketch");
  const [draft, setDraft] = useState<Record<string, string | boolean>>(() => emptyComposerDraft(operations[0] ?? "create_sketch"));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [internalPlan, setInternalPlan] = useState<ComposerOp[]>([]);
  const [runningPlan, setRunningPlan] = useState(false);

  const steps = useMemo(() => {
    if (plan === undefined) return internalPlan;
    try {
      return parseComposerOps(plan);
    } catch {
      return [];
    }
  }, [plan, internalPlan]);

  function commitPlan(next: ComposerOp[]) {
    if (plan === undefined) setInternalPlan(next);
    onPlanChange?.(next);
  }

  function choose(next: ComposerNativeOp) {
    setOperation(next);
    setDraft(emptyComposerDraft(next));
    setError("");
    setEditingId(null);
  }

  function loadStep(step: ComposerOp) {
    setOperation(step.operation);
    setDraft(draftFromParameters(step.operation, step.parameters));
    setReason(step.reason);
    setEditingId(step.id);
    setError("");
  }

  function clearEditor() {
    setDraft(emptyComposerDraft(operation));
    setReason("");
    setEditingId(null);
    setError("");
  }

  function buildDraftOp(): Omit<ComposerOp, "id"> {
    return {
      operation,
      parameters: parametersFromDraft(operation, draft),
      reason,
    };
  }

  async function saveStep() {
    try {
      if (editingId) {
        commitPlan(replaceComposerOp(steps, editingId, buildDraftOp()));
      } else {
        const next = appendComposerOp(steps, buildDraftOp());
        commitPlan(next);
        const added = next[next.length - 1];
        if (added && onAppend) {
          const [payload] = serializeComposerOps([added]);
          if (payload) {
            const result = await onAppend(payload);
            if (appendResultHasFeatureId(result)) {
              rememberComposerFeature(added, result);
              commitPlan(next);
            }
          }
        }
      }
      clearEditor();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save this operation");
    }
  }

  function deleteStep(id: string) {
    commitPlan(removeComposerOp(steps, id));
    if (editingId === id) clearEditor();
  }

  async function runPlannedSteps() {
    if (!onRunPlan) return;
    setError("");
    setRunningPlan(true);
    try {
      // Pass the raw plan so feature_script is rejected by runComposerPlan,
      // not dropped by parse. Empty stays empty — no invented steps.
      const result = await onRunPlan(plan === undefined ? internalPlan : plan);
      if (result && result.ok === false) {
        setError(result.error ?? "Planned steps failed");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not run planned steps");
    } finally {
      setRunningPlan(false);
    }
  }

  return (
    <details className="cad-operation-studio" open>
      <summary>
        <div>
          <span className="eyebrow">MANIPULATION STUDIO</span>
          <strong>Native Onshape operations</strong>
        </div>
        <span className={`app-badge ${platform === "onshape" ? "good" : "setup"}`}>
          {platform === "onshape" ? "Onshape OAuth" : platform === "fusion360" ? "Local add-in" : "Demo adapter"}
        </span>
      </summary>
      <div className="cad-operation-body">
        <p className="app-muted">
          {platform === "fusion360"
            ? "Typed millimetre fields match the paired Fusion add-in allowlist. Execution stays on your desktop."
            : platform === "onshape"
              ? "Edit millimetres and IDs the way Onshape's feature dialog does. Empty fields stay empty."
              : "Plan native operations with typed millimetre fields. Mock adapters do not create production geometry."}
        </p>
        <div role="group" aria-label="Native operations">
          {operations.map((item) => (
            <button
              key={item}
              type="button"
              className="app-button"
              aria-pressed={operation === item}
              disabled={disabled}
              onClick={() => choose(item)}
            >
              {describeComposerOp(item)}
            </button>
          ))}
        </div>
        <CadComposerFields
          operation={operation}
          draft={draft}
          disabled={disabled}
          entities={entities}
          features={features}
          instances={instances}
          onChange={(key, value) => {
            setDraft((current) => ({ ...current, [key]: value }));
            setError("");
          }}
        />
        <label>
          Engineering reason
          <input
            value={reason}
            maxLength={1000}
            disabled={disabled}
            placeholder="Why this feature exists"
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        {error ? (
          <p className="telemetry-status" role="alert">
            {error}
          </p>
        ) : null}
        <div className="cad-operation-grid">
          <button type="button" className="app-button" disabled={disabled} onClick={() => void saveStep()}>
            {editingId ? "Save planned step" : "Add to plan"}
          </button>
          {editingId ? (
            <button type="button" className="app-button" disabled={disabled} onClick={clearEditor}>
              Cancel edit
            </button>
          ) : null}
        </div>
        <section aria-label="Planned operations">
          {steps.length ? (
            <ol>
              {steps.map((step) => (
                <li key={step.id}>
                  <div>
                    <strong>{describeComposerOp(step.operation)}</strong>
                    <p className="app-muted">{summarizeComposerParams(step.operation, step.parameters)}</p>
                    {step.reason ? <p className="app-muted">{step.reason}</p> : null}
                  </div>
                  <div className="cad-operation-grid">
                    <button type="button" className="app-button" disabled={disabled} onClick={() => loadStep(step)}>
                      Edit step
                    </button>
                    <button type="button" className="app-button" disabled={disabled} onClick={() => deleteStep(step.id)}>
                      Delete step
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="app-muted">No planned steps yet. Empty plan stays empty until you add a native operation.</p>
          )}
          {onRunPlan ? (
            <button
              type="button"
              className="app-button"
              disabled={disabled || runningPlan}
              onClick={() => void runPlannedSteps()}
            >
              {runningPlan ? "Running planned steps…" : "Run planned steps"}
            </button>
          ) : null}
        </section>
      </div>
    </details>
  );
}

function appendResultHasFeatureId(
  result: unknown,
): result is { featureId?: unknown; result?: unknown } {
  if (!result || typeof result !== "object" || Array.isArray(result)) return false;
  const record = result as { featureId?: unknown; result?: unknown };
  if (record.featureId != null && record.featureId !== "") return true;
  const nested = record.result;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const nestedId = (nested as { featureId?: unknown }).featureId;
    return nestedId != null && nestedId !== "";
  }
  return false;
}
