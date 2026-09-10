"use client";

import { useCallback, useEffect, useState } from "react";
import { withOrgHref } from "../lib/nav/product-nav";
import { pendingCounts, syncMediaOutbox, syncOutbox as syncScoutOutbox } from "../lib/scout-offline";
import { listOutbox, syncOutbox as syncProductOutbox } from "../lib/offline/outbox";

type ShellOutboxStatusProps = {
  orgId?: string | null;
};

/**
 * Outbox pill for the global shell — scout entries plus queued tasks/chat/hours.
 * Shows pending count, last error, and Retry all when online with a team.
 */
export function ShellOutboxStatus({ orgId }: ShellOutboxStatusProps) {
  const [entries, setEntries] = useState(0);
  const [media, setMedia] = useState(0);
  const [product, setProduct] = useState(0);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void pendingCounts()
      .then((counts) => {
        setEntries(counts.entries);
        setMedia(counts.media);
      })
      .catch(() => undefined);
    if (orgId) {
      void listOutbox(orgId)
        .then((rows) => setProduct(rows.filter((row) => row.status === "queued" || row.status === "conflict").length))
        .catch(() => undefined);
    } else {
      setProduct(0);
    }
  }, [orgId]);

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    updateOnline();
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    refresh();
    const tick = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      refresh();
    }, 12_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [refresh]);

  useEffect(() => {
    if (!orgId) return;
    const drain = () => {
      if (!navigator.onLine) return;
      void syncProductOutbox({ orgId }).then(() => refresh());
    };
    window.addEventListener("online", drain);
    drain();
    return () => window.removeEventListener("online", drain);
  }, [orgId, refresh]);

  const pending = entries + media + product;
  if (pending <= 0 && !lastError) return null;

  const offlineHref = withOrgHref("/offline", orgId ?? null);
  const scoutHref = withOrgHref("/scouting", orgId ?? null);

  async function retryAll() {
    if (!orgId || !navigator.onLine || syncing) return;
    setSyncing(true);
    setLastError(null);
    try {
      await syncScoutOutbox(orgId, {
        onRetry: (n, delayMs) => {
          setLastError(`Retry ${n} in ${Math.round(delayMs / 1000)}s — entries stay queued`);
        },
      });
      await syncMediaOutbox(orgId);
      await syncProductOutbox({ orgId });
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
      <a
        className={`soft-outbox-pill${pending > 0 ? " has-pending" : ""}${lastError ? " has-error" : ""}`}
        href={pending > 0 ? scoutHref : offlineHref}
        title={lastError ?? "Queued work on this device"}
      >
        {pending > 0 ? `Sync pending (${pending})` : "Outbox clear"}
      </a>
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
