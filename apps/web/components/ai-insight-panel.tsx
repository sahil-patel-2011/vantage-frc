"use client";

import { useState } from "react";
import type { InsightKind } from "../lib/ai-insights";
import {
  AI_EXPAND_IDLE,
  expandedDisplay,
  expandFailureState,
  expandSuccessState,
  type AiExpandState,
} from "../lib/ai-expand";
import { AIAttribution, ModelProvenance } from "./ui";
import "./ai-insight-panel.css";

type InsightResponse = {
  text?: string;
  runId?: string;
  provider?: string;
  model?: string;
  sourceCount?: number;
  source?: "computed" | "ai";
  baseUrlOrigin?: string | null;
  keySource?: string | null;
  generatedAt?: string;
  error?: string;
  code?: string;
};

/** Upstream substitutes the literal "unknown" for an unreported field; that is not provenance. */
function realOrNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed && trimmed.toLowerCase() !== "unknown" ? trimmed : null;
}

/**
 * On-demand analysis panel. The default run is deterministic — derived entirely
 * from the org's own data and labeled "Computed from your data" (still metered
 * and ledger-visible via /api/ai-insights → AIOrchestrator). "Expand with AI"
 * is the opt-in metered model path over the same grounded sources; when no
 * adapter resolves or the call fails, the computed text stays on screen.
 * Styling ships with the component (./ai-insight-panel.css).
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
  const [expand, setExpand] = useState<AiExpandState>(AI_EXPAND_IDLE);

  const request = async (mode: "computed" | "ai"): Promise<InsightResponse | null> => {
    const response = await fetch("/api/ai-insights", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, kind, mode, ...(robotLabel ? { robotLabel } : {}) }),
    });
    const data = (await response.json()) as InsightResponse;
    if (!response.ok) {
      if (mode === "ai") {
        setExpand(expandFailureState({ httpStatus: response.status, code: data.code, error: data.error }));
      } else {
        setError(data.error ?? "Analysis failed.");
      }
      return null;
    }
    return data;
  };

  const generate = async () => {
    setBusy(true);
    setError("");
    setExpand(AI_EXPAND_IDLE);
    try {
      const data = await request("computed");
      if (data) setResult(data);
    } catch {
      setError("Network error — analysis not generated.");
    } finally {
      setBusy(false);
    }
  };

  const expandWithAi = async () => {
    setBusy(true);
    setExpand({ status: "loading" });
    try {
      const data = await request("ai");
      if (data) {
        setExpand(
          expandSuccessState({
            text: data.text,
            generatedAt: data.generatedAt,
            provider: data.provider,
            model: data.model,
            baseUrlOrigin: data.baseUrlOrigin,
            keySource: data.keySource,
          }),
        );
      }
    } catch {
      setExpand(expandFailureState({ httpStatus: 0, error: "network error" }));
    } finally {
      setBusy(false);
    }
  };

  const display = result?.text ? expandedDisplay(result.text, expand) : null;

  return (
    <section className="aii-panel app-card" aria-label={title}>
      <header className="aii-head">
        <div>
          <h2>{title}</h2>
          <p className="app-muted">{description}</p>
        </div>
        <button type="button" className="app-button secondary" disabled={busy || !orgId} onClick={() => void generate()}>
          {busy && expand.status !== "loading" ? "Analyzing…" : result ? "Re-run" : "Analyze"}
        </button>
      </header>
      {error ? (
        <p className="aii-error" role="alert">
          {error}
        </p>
      ) : null}
      {display && result ? (
        <>
          <p className="aii-text">{display.text}</p>
          <AIAttribution
            kind="computed"
            feature={kind}
            generatedAt={result.generatedAt ?? new Date().toISOString()}
          />
          {display.aiText && expand.status === "ready" ? (
            <>
              <p className="aii-text aii-ai-text">{display.aiText}</p>
              <AIAttribution kind="ai" feature={kind} generatedAt={expand.expansion.generatedAt} />
              {/* Provenance belongs to the metered model call only — never to the
                  deterministic "Computed from your data" text above it.
                  expandSuccessState() substitutes the literal "unknown" when the
                  route reported nothing, so drop that rather than print it. */}
              <ModelProvenance
                meta={{
                  provider: realOrNull(expand.expansion.provider),
                  modelId: realOrNull(expand.expansion.model),
                  baseUrlOrigin: realOrNull(expand.expansion.baseUrlOrigin),
                  source: realOrNull(expand.expansion.keySource),
                }}
              />
            </>
          ) : (
            <button
              type="button"
              className="app-button secondary"
              disabled={busy || !orgId}
              onClick={() => void expandWithAi()}
            >
              {expand.status === "loading" ? "Expanding…" : "Expand with AI"}
            </button>
          )}
          {display.note ? <p className="aii-note">{display.note}</p> : null}
          <small className="aii-meta">
            {result.model ?? "model"} · {result.sourceCount ?? 0} data source{(result.sourceCount ?? 0) === 1 ? "" : "s"} ·
            metered run{result.runId ? ` ${result.runId.slice(0, 8)}` : ""} · analysis, not a guarantee
          </small>
        </>
      ) : null}
    </section>
  );
}
