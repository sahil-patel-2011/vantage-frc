"use client";

import { useEffect, useState } from "react";
import { relativeTime } from "./relative-time";
import styles from "./ui.module.css";

type FreshnessProps = {
  /** ISO timestamp from the payload. */
  updatedAt: string;
  /** Per-feature threshold; past it the chip flips to an amber "Stale" state. */
  staleAfterMs?: number;
  fetchStatus?: "idle" | "loading" | "error";
  className?: string;
};

/**
 * Live/stale timestamp affordance. Client-recomputes relative time every 10s and flips
 * to an amber ".app-badge.setup" Stale state past `staleAfterMs`. Reuses the StatusBadge language.
 */
export function Freshness({ updatedAt, staleAfterMs, fetchStatus = "idle", className }: FreshnessProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);

  const ts = new Date(updatedAt).getTime();
  const stale = staleAfterMs != null && !Number.isNaN(ts) && now - ts > staleAfterMs;
  const rel = relativeTime(updatedAt, now);

  if (fetchStatus === "error") {
    return (
      <span className={["app-badge", "setup", className].filter(Boolean).join(" ")} title="Last refresh failed">
        Refresh failed
      </span>
    );
  }
  if (stale) {
    return (
      <span
        className={["app-badge", "setup", styles.freshStale, className].filter(Boolean).join(" ")}
        title={`Updated ${rel}`}
      >
        Stale · {rel}
      </span>
    );
  }
  return (
    <span
      className={className}
      style={{ fontSize: 11, color: "var(--soft-muted, #5a6578)" }}
      aria-live="off"
    >
      {fetchStatus === "loading" ? "Updating…" : `Updated ${rel}`}
    </span>
  );
}
