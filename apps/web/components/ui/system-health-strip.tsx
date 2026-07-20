import type { ReactNode } from "react";
import styles from "./ui.module.css";

export type HealthSignal = {
  /** "Adjective not verb" copy: "TBA connected", "Sync pending (3)", "AI 82% of budget". */
  label: ReactNode;
  status: "ok" | "degraded" | "off";
  /** Deep-link to the relevant setup / detail page. */
  href?: string;
  title?: string;
};

const dotClass = { ok: styles.healthOk, degraded: styles.healthDegraded, off: styles.healthOff } as const;

/**
 * Compact horizontal strip of labeled status pills from already-computed signals
 * (tbaConfigured, offline outbox count, billing cap proximity). Pure read — no new fetch.
 * green=ok, amber=degraded/near-cap, grey=not-configured; each pill deep-links to its page.
 */
export function SystemHealthStrip({ signals, className }: { signals: HealthSignal[]; className?: string }) {
  if (signals.length === 0) return null;
  return (
    <div className={[styles.healthStrip, className].filter(Boolean).join(" ")} role="status" aria-label="System health">
      {signals.map((sig, i) => {
        const dot = (
          <span className={[styles.provDot, dotClass[sig.status]].join(" ")} aria-hidden="true" />
        );
        const label = (
          <>
            {dot}
            <span>{sig.label}</span>
          </>
        );
        return sig.href ? (
          <a key={i} href={sig.href} className={styles.healthPill} title={sig.title}>
            {label}
          </a>
        ) : (
          <span key={i} className={styles.healthPill} title={sig.title}>
            {label}
          </span>
        );
      })}
    </div>
  );
}
