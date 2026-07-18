"use client";

import { useState } from "react";
import {
  buildUsageCutoffSnapshot,
  cutoffCtas,
  evaluateUsageCutoff,
  isCutoffError,
  messageForCutoffError,
  resolveCutoffErrorCode,
  type CutoffCta,
  type UsageCutoffAlert,
  type UsageCutoffSnapshot,
} from "../lib/billing/usage-cutoff";

type BannerProps = {
  orgId: string;
  snapshot?: UsageCutoffSnapshot | null;
  /** When an AI call already failed with a cutoff code/message. */
  errorCode?: string | null;
  className?: string;
  compact?: boolean;
};

async function startCheckout(orgId: string, cta: CutoffCta): Promise<string | null> {
  if (!cta.checkoutAction) return cta.href ?? null;
  const response = await fetch("/api/billing/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      orgId,
      action: cta.checkoutAction,
      packCode: cta.packCode,
      planCode: cta.planCode,
    }),
  });
  const data = (await response.json()) as { url?: string; error?: string };
  if (response.ok && data.url) return data.url;
  return cta.href ?? "/pricing";
}

function BannerShell({
  level,
  title,
  body,
  percent,
  ctas,
  orgId,
  className,
  compact,
}: {
  level: "near" | "at";
  title: string;
  body: string;
  percent: number | null;
  ctas: CutoffCta[];
  orgId: string;
  className?: string;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [hint, setHint] = useState("");

  async function onCta(cta: CutoffCta) {
    if (cta.href && !cta.checkoutAction) {
      window.location.href = cta.href;
      return;
    }
    setBusy(cta.id);
    setHint("");
    try {
      const url = await startCheckout(orgId, cta);
      if (url) window.location.href = url;
      else setHint("Checkout is not configured yet — open Pricing to continue.");
    } catch {
      setHint("Checkout unavailable. Open Pricing or API budgets instead.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <aside
      className={["usage-cutoff-banner", `tone-${level}`, compact ? "compact" : "", className]
        .filter(Boolean)
        .join(" ")}
      role={level === "at" ? "alert" : "status"}
      aria-live="polite"
    >
      <div className="usage-cutoff-banner-copy">
        <strong>
          {level === "at" ? "Hard cut-off" : "Near limit"}
          {percent != null ? ` · ${Math.min(999, Math.round(percent))}%` : ""}
        </strong>
        <span className="usage-cutoff-banner-title">{title}</span>
        {!compact ? <p>{body}</p> : null}
        {hint ? <p className="usage-cutoff-hint">{hint}</p> : null}
      </div>
      <div className="usage-cutoff-banner-ctas">
        {ctas.map((cta) =>
          cta.checkoutAction ? (
            <button
              key={cta.id}
              type="button"
              className={cta.id === "credits" || cta.id === "upgrade" ? "primary-action" : "app-button secondary"}
              disabled={busy != null}
              onClick={() => void onCta(cta)}
            >
              {busy === cta.id ? "Opening…" : cta.label}
            </button>
          ) : (
            <a key={cta.id} className="app-button secondary" href={cta.href ?? "/pricing"}>
              {cta.label}
            </a>
          ),
        )}
      </div>
    </aside>
  );
}

/** Soft-UI banner for near/at plan allowance, credits, PAYG, or org budget hard cut-offs. */
export function UsageCutoffBanner({ orgId, snapshot, errorCode, className, compact }: BannerProps) {
  let alert: UsageCutoffAlert | null = null;
  if (errorCode) {
    const mapped = messageForCutoffError(errorCode, orgId);
    alert = { level: "at", reason: "allowance", title: mapped.title, body: mapped.body, percent: null };
    return (
      <BannerShell
        level="at"
        title={mapped.title}
        body={mapped.body}
        percent={null}
        ctas={mapped.ctas}
        orgId={orgId}
        className={className}
        compact={compact}
      />
    );
  }
  if (snapshot) alert = evaluateUsageCutoff(snapshot);
  if (!alert || alert.level === "ok") return null;
  return (
    <BannerShell
      level={alert.level}
      title={alert.title}
      body={alert.body}
      percent={alert.percent}
      ctas={cutoffCtas(alert, orgId)}
      orgId={orgId}
      className={className}
      compact={compact}
    />
  );
}

export {
  evaluateUsageCutoff,
  buildUsageCutoffSnapshot,
  messageForCutoffError,
  isCutoffError,
  resolveCutoffErrorCode,
};
