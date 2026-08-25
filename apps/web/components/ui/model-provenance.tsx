"use client";

import { useEffect, useState } from "react";
import {
  hasProvenance,
  provenanceLabel,
  provenanceNotice,
  provenanceNoticeId,
  provenanceSourceLabel,
  type ModelProvenance,
} from "./model-provenance-policy";
import "./model-provenance.css";

export {
  hasProvenance,
  provenanceEndpointLabel,
  provenanceLabel,
  provenanceNotice,
  provenanceNoticeId,
  provenanceOriginHost,
  provenanceSourceLabel,
  UNKNOWN_ENDPOINT_LABEL,
  UNKNOWN_MODEL_LABEL,
} from "./model-provenance-policy";
/** The metadata shape, aliased so it does not collide with the component name. */
export type { ModelProvenance as ModelProvenanceMeta, ModelTier } from "./model-provenance-policy";

type ModelProvenanceProps = {
  /**
   * What the route reported about the call that produced the content on screen.
   * Render nothing when the route reports nothing — never guess an endpoint.
   */
  meta: ModelProvenance | null | undefined;
  /**
   * Quality notice from `degradedNoticeCopy` in `@vantage/agent`. Pass `null`
   * to suppress; omit to let the local fallback decide (see the policy module).
   */
  notice?: string | null;
  /** Hide the "· using your team's key" clause where the surface already says it. */
  hideSource?: boolean;
  className?: string;
};

const DISMISSED = new Set<string>();

function readDismissed(id: string): boolean {
  if (DISMISSED.has(id)) return true;
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(id) === "1";
  } catch {
    // Private-mode / blocked storage: fall back to the in-memory set, which
    // still holds for the life of the page.
    return false;
  }
}

function persistDismissed(id: string): void {
  DISMISSED.add(id);
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(id, "1");
  } catch {
    /* storage unavailable — the in-memory set is enough for this page */
  }
}

const InfoGlyph = () => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="6.6" stroke="currentColor" strokeWidth="1.5" />
    <path d="M8 7.1v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <circle cx="8" cy="4.8" r="0.95" fill="currentColor" />
  </svg>
);

/**
 * The same provenance line on every AI surface: which endpoint answered, which
 * model, and — on a small model — one dismissible informational note about what
 * to expect from it.
 *
 * Deliberately NOT an error/warning tone. A team running Ollama on a shop
 * laptop gets every Vantage AI feature; this tells them what they're running,
 * it does not tell them they're doing it wrong.
 */
export function ModelProvenance({
  meta,
  notice,
  hideSource = false,
  className,
}: ModelProvenanceProps) {
  const id = meta ? provenanceNoticeId(meta) : "";
  const [dismissed, setDismissed] = useState(false);

  // Read storage after mount so server and first client render agree.
  useEffect(() => {
    if (!id) return;
    setDismissed(readDismissed(id));
  }, [id]);

  if (!hasProvenance(meta) || !meta) return null;

  const label = provenanceLabel(meta);
  const source = hideSource ? null : provenanceSourceLabel(meta.source);
  const text = provenanceNotice(meta, notice);

  return (
    <div className={["vmp-root", className].filter(Boolean).join(" ")}>
      <p className="vmp-line">
        <span className="vmp-endpoint">{label}</span>
        {source ? <span className="vmp-source"> · using {source}</span> : null}
      </p>
      {text && !dismissed ? (
        <aside className="vmp-notice" aria-label="Model quality notice">
          <span className="vmp-notice-icon">
            <InfoGlyph />
          </span>
          <p className="vmp-notice-text">{text}</p>
          <button
            type="button"
            className="vmp-dismiss"
            onClick={() => {
              persistDismissed(id);
              setDismissed(true);
            }}
          >
            Got it
          </button>
        </aside>
      ) : null}
    </div>
  );
}

export default ModelProvenance;
