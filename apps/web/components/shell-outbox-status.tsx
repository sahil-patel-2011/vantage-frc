"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { withOrgHref } from "../lib/nav/product-nav";
import { pendingCounts, syncMediaOutbox, syncOutbox as syncScoutOutbox } from "../lib/scout-offline";
import { listOutbox, syncOutbox as syncProductOutbox } from "../lib/offline/outbox";

type ShellOutboxStatusProps = {
  orgId?: string | null;
  /** Where "Sync pending" leads: Vantage's scouting page by default, Scouting's own form in its frame. */
  scoutPath?: string;
};

/** Quiet retry while anything waits: venue Wi-Fi often says "connected" with no internet, so the
 *  browser's `online` event never fires when it really comes back. */
const RETRY_MS = 45_000;

/**
 * Outbox pill for the global shell — scout entries plus queued tasks/chat/hours.
 * Shows pending count, last error, and Retry all when online with a team.
 */
export function ShellOutboxStatus({ orgId, scoutPath = "/scouting" }: ShellOutboxStatusProps) {
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

  /*
    Everything queued on this device goes when the connection is back — scout entries and
    photos included. Those used to wait for the scout to open the Scout page or press Retry
    all, so a morning of entries could sit on a phone that had signal again. Entries carry a
    client id the server de-duplicates on, so a retry that overlaps the Scout page's own
    sync cannot double-file one; the ref still keeps this shell from starting two at once.
  */
  const draining = useRef(false);
  const pendingRef = useRef(0);
  pendingRef.current = entries + media + product;
  useEffect(() => {
    if (!orgId) return;
    const drain = () => {
      if (!navigator.onLine || draining.current) return;
      draining.current = true;
      void (async () => {
        try {
          await syncProductOutbox({ orgId });
          const counts = await pendingCounts();
          if (counts.entries > 0) await syncScoutOutbox(orgId, { maxAttempts: 1 });
          if (counts.media > 0) await syncMediaOutbox(orgId, { maxAttempts: 1 });
        } catch {
          // Still offline in practice, or the server said wait: the outbox keeps everything.
        } finally {
          draining.current = false;
          refresh();
        }
      })();
    };
    window.addEventListener("online", drain);
    drain();
    const retry = window.setInterval(() => {
      if (document.visibilityState === "visible" && pendingRef.current > 0) drain();
    }, RETRY_MS);
    return () => {
      window.removeEventListener("online", drain);
      window.clearInterval(retry);
    };
  }, [orgId, refresh]);

  const pending = entries + media + product;
  if (pending <= 0 && !lastError) return null;

  const offlineHref = withOrgHref("/offline", orgId ?? null);
  const scoutHref = withOrgHref(scoutPath, orgId ?? null);

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
