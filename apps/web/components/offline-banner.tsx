"use client";

import { useEffect, useState } from "react";
import { useOnline } from "../lib/offline/use-online";
import "./offline-banner.css";

type OfflineBannerProps = {
  /** When true, last-good data is shown from IndexedDB / local cache. */
  fromCache?: boolean;
  /** Optional cachedAt ISO timestamp for “as of” copy. */
  cachedAt?: string | null;
  /** Surface name, e.g. Scouting / Calendar / Todos / Logistics. */
  feature?: string;
  /** Extra note (pending sync counts, read-only edits, etc.). */
  detail?: string;
  className?: string;
  /**
   * Show even while navigator.onLine — flaky venue Wi-Fi / outbox backoff.
   * Pair with variant="syncing" | "degraded".
   */
  force?: boolean;
  /** Visual/copy tone. Default offline (hidden when online unless force). */
  variant?: "offline" | "syncing" | "degraded";
};

function formatCachedAt(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatTime(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * Soft-UI banner for venue Wi-Fi drops and flaky sync.
 * Hidden while online unless `force` (retry/backoff / degraded).
 * Place near PageHeader on offline-capable product pages.
 * Copy never invents DEMO sync counts — only caller-supplied detail may mention real queues.
 */
export function OfflineBanner({
  fromCache = false,
  cachedAt = null,
  feature,
  detail,
  className = "",
  force = false,
  variant = "offline",
}: OfflineBannerProps) {
  const online = useOnline();
  // When this page last had a connection. A page that loaded fine and then lost signal is not a
  // cold start, and was given the cold-start advice (visit once online first) while everything
  // was on screen.
  const [loadedOnlineAt, setLoadedOnlineAt] = useState<string | null>(null);
  useEffect(() => {
    // navigator.onLine too: useOnline starts true for the server render.
    if (online && navigator.onLine) setLoadedOnlineAt(new Date().toISOString());
  }, [online]);
  const tone = force && variant !== "offline" ? variant : "offline";
  if (online && !force) return null;

  const when = formatCachedAt(cachedAt);
  const loadedAt = formatTime(loadedOnlineAt);
  let title: string;
  let body: string;

  if (tone === "syncing") {
    title = feature ? `${feature} · syncing` : "Syncing outbox";
    body =
      detail ??
      "Connection is back. Uploading queued scout entries with retry/backoff — keep this page open.";
  } else if (tone === "degraded") {
    title = feature ? `${feature} · flaky link` : "Connection flaky";
    body =
      detail ??
      "Venue Wi-Fi is unstable. Entries stay in the on-device outbox; sync retries automatically, or use QR handoff.";
  } else {
    title = "You're offline";
    body = fromCache
      ? `Showing the last copy saved on this device${when ? ` (${when})` : ""}. Changes that need the internet wait until you reconnect.`
      : loadedAt
        ? `Showing what was loaded at ${loadedAt}. Changes that need the internet wait until you reconnect.`
        : `${feature ?? "This page"} hasn't been saved on this device yet. Open it once while you have signal, and it will work without it next time.`;
  }

  return (
    <div
      className={`offline-banner offline-banner--${tone} ${className}`.trim()}
      role="status"
      aria-live="polite"
      data-soft-ui="offline-banner"
    >
      <strong>{title}</strong>
      <span>{detail ?? body}</span>
    </div>
  );
}

export function OfflinePill({ label }: { label?: string }) {
  const online = useOnline();
  return (
    <span className={`network ${online ? "online" : "offline"}`} role="status">
      {online ? "Online" : label ?? "Offline · cached"}
    </span>
  );
}
