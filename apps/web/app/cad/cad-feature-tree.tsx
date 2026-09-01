"use client";

import { useMemo, useState } from "react";
import {
  parseExplainFeatures,
  updateFeaturePayload,
  type ExplainedFeature,
  type UpdateFeaturePayload,
} from "../../lib/cad/feature-tree";

export type CadFeatureTreeProps = {
  features?: ExplainedFeature[] | unknown;
  disabled?: boolean;
  onUpdate: (payload: UpdateFeaturePayload) => void | Promise<unknown>;
};

type MmDraft = {
  depthMm: string;
  widthMm: string;
  heightMm: string;
};

const EMPTY_DRAFT: MmDraft = { depthMm: "", widthMm: "", heightMm: "" };

function isExplainedFeature(value: unknown): value is ExplainedFeature {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.featureId === "string" && row.featureId.trim().length > 0;
}

export function CadFeatureTree({ features, disabled = false, onUpdate }: CadFeatureTreeProps) {
  const rows = useMemo(() => {
    if (Array.isArray(features) && features.every(isExplainedFeature)) {
      return features.map((row) => ({
        featureId: row.featureId.trim(),
        name: row.name,
        type: row.type,
      }));
    }
    return parseExplainFeatures(features);
  }, [features]);

  const [drafts, setDrafts] = useState<Record<string, MmDraft>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  function draftFor(featureId: string): MmDraft {
    return drafts[featureId] ?? EMPTY_DRAFT;
  }

  function setField(featureId: string, key: keyof MmDraft, value: string) {
    setDrafts((current) => ({
      ...current,
      [featureId]: { ...draftFor(featureId), [key]: value },
    }));
    setError("");
  }

  async function submit(featureId: string) {
    const draft = draftFor(featureId);
    setError("");
    setBusyId(featureId);
    try {
      const payload = updateFeaturePayload({
        featureId,
        depthMm: draft.depthMm.trim() || undefined,
        widthMm: draft.widthMm.trim() || undefined,
        heightMm: draft.heightMm.trim() || undefined,
      });
      await onUpdate(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update this feature");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <details className="cad-operation-studio" open>
      <summary>
        <div>
          <span className="eyebrow">FEATURE TREE</span>
          <strong>Re-edit native Onshape features</strong>
        </div>
        <span className={`app-badge ${rows.length ? "good" : "setup"}`}>
          {rows.length ? `${rows.length} feature${rows.length === 1 ? "" : "s"}` : "No features"}
        </span>
      </summary>
      <div className="cad-operation-body">
        <p className="app-muted">
          Depth, width, and height are millimetres on the feature Onshape already created. Empty fields stay
          empty — IDs are never invented.
        </p>
        {error ? (
          <p className="telemetry-status" role="alert">
            {error}
          </p>
        ) : null}
        <section aria-label="Onshape features">
          {rows.length ? (
            <ol>
              {rows.map((row) => {
                const draft = draftFor(row.featureId);
                const busy = busyId === row.featureId;
                return (
                  <li key={row.featureId}>
                    <div>
                      <strong>{row.name || row.type || row.featureId}</strong>
                      <p className="app-muted">
                        {row.type ? `${row.type} · ` : ""}
                        {row.featureId}
                      </p>
                    </div>
                    <div className="cad-operation-grid">
                      <label>
                        Depth (mm)
                        <input
                          type="number"
                          inputMode="decimal"
                          step="any"
                          min="0"
                          placeholder="mm"
                          value={draft.depthMm}
                          disabled={disabled || busy}
                          onChange={(event) => setField(row.featureId, "depthMm", event.target.value)}
                        />
                      </label>
                      <label>
                        Width (mm)
                        <input
                          type="number"
                          inputMode="decimal"
                          step="any"
                          min="0"
                          placeholder="mm"
                          value={draft.widthMm}
                          disabled={disabled || busy}
                          onChange={(event) => setField(row.featureId, "widthMm", event.target.value)}
                        />
                      </label>
                      <label>
                        Height (mm)
                        <input
                          type="number"
                          inputMode="decimal"
                          step="any"
                          min="0"
                          placeholder="mm"
                          value={draft.heightMm}
                          disabled={disabled || busy}
                          onChange={(event) => setField(row.featureId, "heightMm", event.target.value)}
                        />
                      </label>
                      <button
                        type="button"
                        className="app-button"
                        disabled={disabled || busy}
                        onClick={() => void submit(row.featureId)}
                      >
                        {busy ? "Updating…" : "Update feature"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="app-muted">
              No native features yet. Load explain-onshape-features from a bound Part Studio — the list stays
              empty until Onshape returns real feature ids.
            </p>
          )}
        </section>
      </div>
    </details>
  );
}
