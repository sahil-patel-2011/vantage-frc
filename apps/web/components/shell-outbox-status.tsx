"use client";

import { useCallback, useEffect, useState } from "react";
import { withOrgHref } from "../lib/nav/product-nav";
import { pendingCounts, syncMediaOutbox, syncOutbox } from "../lib/scout-offline";

type ShellOutboxStatusProps = {
  orgId?: string | null;
};

/**
 * Compact Soft-UI outbox pill for the global shell — real IndexedDB counts only.
 * Shows pending count, quarantined ("stuck") count, last error, and Retry all
 * when online with a workspace.
 */
export function ShellOutboxStatus({ orgId }: ShellOutboxStatusProps) {
  const [entries, setEntries] = useState(0);
  const [media, setMedia] = useState(0);
  const [quarantined, setQuarantined] = useState(0);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void pendingCounts()
      .then((counts) => {
        setEntries(counts.entries);
        setMedia(counts.media);
        setQuarantined(counts.quarantined);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    updateOnline();
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    refresh();
    const tick = window.setInterval(refresh, 12_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [refresh]);

  const pending = entries + media;
  if (pending <= 0 && quarantined <= 0 && !lastError) return null;

  const offlineHref = withOrgHref("/offline", orgId ?? null);
  const scoutHref = withOrgHref("/scouting", orgId ?? null);
  // Quarantined items are NOT pending — they need a human Retry/Discard on the
  // scouting page's attention panel, so the pill links straight to it.
  const quarantineHref = withOrgHref("/scouting#scout-quarantine", orgId ?? null);

  async function retryAll() {
    if (!orgId || !navigator.onLine || syncing) return;
    setSyncing(true);
    setLastError(null);
    try {
      await syncOutbox(orgId, {
        onRetry: (n, delayMs) => {
          setLastError(`Retry ${n} in ${Math.round(delayMs / 1000)}s — entries stay queued`);
        },
      });
      await syncMediaOutbox(orgId);
      setLastError(null);
    } catch (error) {
      setLastError(error instanceof Error ? error.message : "Sync paused — outbox kept");
    } finally {
      setSyncing(false);
      refresh();
    }
  }

  return (
    <div className="soft-outbox-status" role="status" aria-live="polite">
      {pending > 0 || lastError || quarantined <= 0 ? (
        <a
          className={`soft-outbox-pill${pending > 0 ? " has-pending" : ""}${lastError ? " has-error" : ""}`}
          href={pending > 0 ? scoutHref : offlineHref}
          title={lastError ?? "Scout outbox on this device"}
        >
          {pending > 0 ? `Sync pending (${pending})` : "Outbox clear"}
        </a>
      ) : null}
      {quarantined > 0 ? (
        <a
          className="soft-outbox-pill has-error"
          href={quarantineHref}
          title={`${quarantined} ${quarantined === 1 ? "item" : "items"} the server rejected — retry or discard on the scouting page`}
        >
          {quarantined} stuck
        </a>
      ) : null}
      {pending > 0 && orgId && online ? (
        <button
          type="button"
          className="soft-outbox-retry"
          disabled={syncing}
          onClick={() => void retryAll()}
        >
          {syncing ? "Retrying…" : "Retry all"}
        </button>
      ) : null}
      {lastError ? <span className="soft-outbox-error">{lastError}</span> : null}
    </div>
  );
}
