"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { withOrgHref } from "../lib/nav/product-nav";
import { pendingCounts, SCOUT_OUTBOX_CHANGED_EVENT, syncMediaOutbox, syncOutbox as syncScoutOutbox } from "../lib/scout-offline";
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
    void pendingCounts(orgId ?? undefined)
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

  // A save or a send on this page: count again now, not at the next 12-second check, and say
  // when reports went out, so a scout who saved offline and closed the page can tell "sent"
  // from "lost" when it drains later.
  const [sentNote, setSentNote] = useState<string | null>(null);
  useEffect(() => {
    let clear: number | undefined;
    const onChanged = (event: Event) => {
      refresh();
      const sent = Number((event as CustomEvent<{ sent?: number }>).detail?.sent ?? 0);
      if (sent > 0) {
        setSentNote(`${sent} ${sent === 1 ? "report" : "reports"} sent to your team`);
        window.clearTimeout(clear);
        clear = window.setTimeout(() => setSentNote(null), 8_000);
      }
    };
    window.addEventListener(SCOUT_OUTBOX_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener(SCOUT_OUTBOX_CHANGED_EVENT, onChanged);
      window.clearTimeout(clear);
    };
  }, [refresh]);

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
          const counts = await pendingCounts(orgId);
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
  if (pending <= 0 && !lastError) {
    return sentNote ? (
      <div className="soft-outbox-status" role="status" aria-live="polite">
        <span className="soft-outbox-pill">{sentNote}</span>
      </div>
    ) : null;
  }

  const offlineHref = withOrgHref("/offline", orgId ?? null);
  const scoutHref = withOrgHref(scoutPath, orgId ?? null);

  async function retryAll() {
    if (!orgId || !navigator.onLine || syncing) return;
    setSyncing(true);
    setLastError(null);
    try {
      const scout = await syncScoutOutbox(orgId, {
        onRetry: (n, delayMs) => {
          setLastError(`Retry ${n} in ${Math.round(delayMs / 1000)}s — entries stay queued`);
        },
      });
      await syncMediaOutbox(orgId);
      await syncProductOutbox({ orgId });
      // "Finished" is not "sent": say why scouting entries are still here.
      setLastError(
        scout.failure === "signed-out"
          ? "You are signed out. Sign in again to send what is waiting."
          : scout.failure
            ? "Your team’s server didn’t answer. Entries stay on this device."
            : null,
      );
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
