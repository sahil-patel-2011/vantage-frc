"use client";
import { useState } from "react";
type Evaluation = { modelVersion: string; matches: number; accuracy: number; logLoss: number; brier: number };
export function PredictionEvaluation({ orgId }: { orgId: string | null }) {
  const [models, setModels] = useState<Evaluation[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <details className="strategy-evaluation app-card" onToggle={async event => {
    if (!event.currentTarget.open || !orgId || busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/strategy/evaluation?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store" });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Could not evaluate predictions.");
      setModels(data.models); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not evaluate predictions."); }
    finally { setBusy(false); }
  }}><summary>Model performance</summary><p>Measured against official results, using predictions saved before each match started. Ties and later recomputations are excluded.</p>
    {busy ? <p role="status">Loading results…</p> : error ? <p role="alert">{error}</p> : models?.length ? <dl>{models.map(model => <div key={model.modelVersion}><dt>{model.modelVersion} · {model.matches} matches</dt><dd>{(model.accuracy*100).toFixed(1)}% correct · Log loss {model.logLoss.toFixed(3)} · Brier {model.brier.toFixed(3)}</dd></div>)}</dl> : models ? <p>No completed matches with a saved pre-match prediction yet.</p> : null}
    <small>Lower log loss and Brier scores indicate better confidence. Accuracy alone does not measure calibration.</small>
  </details>;
}
