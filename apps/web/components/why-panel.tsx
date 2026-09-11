"use client";

import { useCallback, useId, useMemo, useState } from "react";
import {
  EXPLAIN_LEVELS,
  narrationCoverage,
  type ExplainLevel,
  type Narration,
} from "../lib/agent-narration/narration";
import {
  useNarrationAudience,
  type NarrationAudience,
} from "../lib/agent-narration/use-narration-audience";
import "./why-panel.css";

/**
 * WhyPanel — the reusable "show your work" disclosure.
 *
 * Renders a Narration list beside/below any agent output. Collapsed by default for mentors,
 * expanded by default for students. Every step shows what happened; the why appears only when
 * the underlying data recorded one, and a missing why is stated as missing rather than filled in.
 */
export type WhyPanelProps = {
  narrations: Narration[];
  /** Overrides the profile-derived audience. */
  audience?: NarrationAudience;
  /** Overrides the audience default outright. */
  defaultExpanded?: boolean;
  title?: string;
  subtitle?: string;
  /** Required to enable the metered "Explain this differently" action. */
  orgId?: string;
  /** Turn off the metered explain action (e.g. on a read-only surface). */
  explainable?: boolean;
  className?: string;
};

type ExplainState = {
  text?: string;
  error?: string;
  code?: string | null;
  busy?: boolean;
  level?: ExplainLevel;
};

function statusLabel(status: Narration["status"]): string {
  switch (status) {
    case "setup_required":
      return "Needs setup";
    case "pending":
      return "not run yet";
    case "ok":
      return "Done";
    case "empty":
      return "Nothing found";
    case "error":
      return "Error";
    default: {
      const _never: never = status;
      return _never;
    }
  }
}

export function WhyPanel({
  narrations,
  audience,
  defaultExpanded,
  title = "Why the agent did this",
  subtitle,
  orgId,
  explainable = true,
  className,
}: WhyPanelProps) {
  const reactId = useId();
  const detectedAudience = useNarrationAudience(audience == null);
  const readerAudience = audience ?? detectedAudience;
  const initiallyOpen = defaultExpanded ?? readerAudience === "student";
  const [openOverride, setOpenOverride] = useState<boolean | null>(null);
  const open = openOverride ?? initiallyOpen;
  const [explanations, setExplanations] = useState<Record<string, ExplainState>>({});
  /** Which level the reader last asked for, per step — so only that answer is shown. */
  const [activeLevel, setActiveLevel] = useState<Record<string, ExplainLevel>>({});

  const coverage = useMemo(() => narrationCoverage(narrations), [narrations]);
  const canExplain = Boolean(explainable && orgId);

  const explain = useCallback(
    async (narration: Narration, level: ExplainLevel) => {
      if (!orgId) return;
      const cacheKey = `${narration.key}:${level}`;
      setActiveLevel((prev) => ({ ...prev, [narration.key]: level }));
      // Trivially cacheable: the same step at the same level never changes, so never pay twice.
      if (explanations[cacheKey]?.text) return;
      setExplanations((prev) => ({ ...prev, [cacheKey]: { busy: true, level } }));
      try {
        const response = await fetch("/api/agent-narration/explain", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, level, narration }),
        });
        const data = (await response.json()) as {
          text?: string;
          error?: string;
          code?: string;
        };
        if (!response.ok || !data.text) {
          setExplanations((prev) => ({
            ...prev,
            [cacheKey]: {
              error: data.error ?? "Could not re-explain this step.",
              code: data.code ?? null,
              level,
            },
          }));
          return;
        }
        setExplanations((prev) => ({ ...prev, [cacheKey]: { text: data.text, level } }));
      } catch (error) {
        setExplanations((prev) => ({
          ...prev,
          [cacheKey]: {
            error: error instanceof Error ? error.message : "Could not re-explain this step.",
            level,
          },
        }));
      }
    },
    [explanations, orgId],
  );

  const panelId = `why-panel-${reactId.replace(/[^a-z0-9]+/gi, "-")}`;

  if (!narrations.length) return null;

  return (
    <section className={className ? `why-panel ${className}` : "why-panel"} aria-label={title}>
      <button
        type="button"
        className="why-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpenOverride(!open)}
      >
        <span className="why-toggle-caret" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        <span className="why-toggle-text">
          <strong>{title}</strong>
          <small>
            {subtitle
              ? subtitle
              : `${coverage.total} step${coverage.total === 1 ? "" : "s"} · ${coverage.explained} with a recorded reason`}
          </small>
        </span>
        <span className="why-toggle-hint">{open ? "Hide" : "Show"}</span>
      </button>

      <ol className="why-steps" id={panelId} hidden={!open}>
          {narrations.map((narration) => {
            const levelKey = (level: ExplainLevel) => `${narration.key}:${level}`;
            const shownLevel = activeLevel[narration.key];
            const active = shownLevel ? explanations[levelKey(shownLevel)] : undefined;
            return (
              <li key={narration.key} className="why-step">
                <div className="why-step-head">
                  <span className="why-step-index" aria-hidden="true">
                    {narration.step}
                  </span>
                  <p className="why-action">{narration.action}</p>
                  {narration.status !== "ok" ? (
                    <span className={`why-status why-status--${narration.status}`}>
                      {statusLabel(narration.status)}
                    </span>
                  ) : null}
                </div>

                {narration.outcome ? <p className="why-outcome">{narration.outcome}</p> : null}

                {narration.why ? (
                  <p className="why-reason">
                    <span>Why</span>
                    {narration.why}
                  </p>
                ) : (
                  <p className="why-reason why-reason--missing">
                    <span>Why</span>
                    No reason was recorded with this step, so none is shown.
                  </p>
                )}

                {narration.principle ? (
                  <p className="why-principle">
                    <span>Principle</span>
                    {narration.principle}
                  </p>
                ) : null}

                {narration.sources?.length ? (
                  <ul className="why-sources">
                    {narration.sources.map((source, index) => (
                      <li key={`${narration.key}-src-${index}`}>
                        {source.url ? (
                          <a href={source.url} target="_blank" rel="noreferrer">
                            {source.label}
                          </a>
                        ) : (
                          <span>{source.label}</span>
                        )}
                        {source.excerpt ? <code>{source.excerpt}</code> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {canExplain ? (
                  <div className="why-explain">
                    <span className="why-explain-label">Explain this differently</span>
                    <div className="why-explain-actions">
                      {EXPLAIN_LEVELS.map((level) => {
                        const state = explanations[levelKey(level.id)];
                        return (
                          <button
                            key={level.id}
                            type="button"
                            className="why-explain-button"
                            title={level.hint}
                            disabled={Boolean(state?.busy)}
                            onClick={() => void explain(narration, level.id)}
                          >
                            {state?.busy ? "Asking…" : level.label}
                          </button>
                        );
                      })}
                    </div>
                    {active?.text ? (
                      <p className="why-explain-text" role="status">
                        {active.text}
                      </p>
                    ) : null}
                    {active?.error ? (
                      <p className="why-explain-error" role="status">
                        {active.error}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
      </ol>
    </section>
  );
}

export default WhyPanel;
