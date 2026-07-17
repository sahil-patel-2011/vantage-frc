"use client";

import { useState } from "react";
import type { InsightKind } from "../lib/ai-insights";

type InsightResponse = {
  text?: string;
  runId?: string;
  provider?: string;
  model?: string;
  sourceCount?: number;
  error?: string;
};

/**
 * On-demand AI analysis panel. Runs through /api/ai-insights → AIOrchestrator,
 * so every generation is metered, provenance-recorded, and visible in the AI
 * runs ledger. Styling comes from the host feature's co-located CSS via the
 * shared .aii-* classes (each feature CSS defines them).
 */
export function AiInsightPanel({
  orgId,
  kind,
  title,
  description,
  robotLabel,
}: {
  orgId: string;
  kind: InsightKind;
  title: string;
  description: string;
  robotLabel?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<InsightResponse | null>(null);

  const generate = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/ai-insights", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, kind, ...(robotLabel ? { robotLabel } : {}) }),
      });
      const data = (await response.json()) as InsightResponse;
      if (!response.ok) {
        setError(data.error ?? "Insight generation failed.");
        return;
      }
      setResult(data);
    } catch {
      setError("Network error — insight not generated.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="aii-panel app-card" aria-label={title}>
      <header className="aii-head">
        <div>
          <h2>
            <span aria-hidden="true">✦</span> {title}
          </h2>
          <p className="app-muted">{description}</p>
        </div>
        <button type="button" className="app-button secondary" disabled={busy || !orgId} onClick={() => void generate()}>
          {busy ? "Analyzing…" : result ? "Re-run" : "Generate"}
        </button>
      </header>
      {error ? (
        <p className="aii-error" role="alert">
          {error}
        </p>
      ) : null}
      {result?.text ? (
        <>
          <p className="aii-text">{result.text}</p>
          <small className="aii-meta">
            {result.model ?? "model"} · {result.sourceCount ?? 0} data source{(result.sourceCount ?? 0) === 1 ? "" : "s"} ·
            metered run{result.runId ? ` ${result.runId.slice(0, 8)}` : ""} · analysis, not a guarantee
          </small>
        </>
      ) : null}
    </section>
  );
}
