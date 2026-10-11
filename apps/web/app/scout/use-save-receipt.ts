"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SCOUT_OUTBOX_CHANGED_EVENT } from "../../lib/scout-offline";
import { recheckSavedEntry, sendSavedEntry } from "../../lib/scouting/send-saved-entry";
import type { ReceiptStatus } from "../../lib/scouting/sync-receipt";

type Receipt<Extra> = Extra & { clientId: string; status: ReceiptStatus };

/** Still on the phone, so worth sending again or looking again. */
function unsent(status: ReceiptStatus): boolean {
  return status.sync === "waiting" || status.sync === "queued" || status.sync === "unreachable" || status.sync === "signed-out";
}

/**
 * The receipt after Save on the quick screens: sends the outbox, then reports where this entry
 * actually is. It follows the entry afterwards too: back online it sends again, and when the
 * frame's background send delivers it the receipt turns to "Sent".
 */
export function useSaveReceipt<Extra extends object>(orgId: string) {
  const [receipt, setReceipt] = useState<Receipt<Extra> | null>(null);
  const latest = useRef(receipt);
  latest.current = receipt;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const update = useCallback((clientId: string, status: ReceiptStatus) => {
    if (!mounted.current) return;
    setReceipt((current) => (current && current.clientId === clientId ? { ...current, status } : current));
  }, []);

  const send = useCallback(
    async (clientId: string) => {
      update(clientId, { sync: navigator.onLine ? "sending" : "waiting" });
      update(clientId, await sendSavedEntry(orgId, clientId));
    },
    [orgId, update],
  );

  const show = useCallback(
    (value: Extra & { clientId: string }) => {
      setReceipt({ ...value, status: { sync: navigator.onLine ? "sending" : "waiting" } } as Receipt<Extra>);
      void send(value.clientId);
    },
    [send],
  );

  useEffect(() => {
    const onOnline = () => {
      const current = latest.current;
      if (current && unsent(current.status)) void send(current.clientId);
    };
    const onChanged = () => {
      const current = latest.current;
      if (!current || !unsent(current.status)) return;
      void recheckSavedEntry(orgId, current.clientId, current.status).then((status) => update(current.clientId, status));
    };
    window.addEventListener("online", onOnline);
    window.addEventListener(SCOUT_OUTBOX_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener(SCOUT_OUTBOX_CHANGED_EVENT, onChanged);
    };
  }, [orgId, send, update]);

  const retry = useCallback(() => {
    if (latest.current) void send(latest.current.clientId);
  }, [send]);
  const clear = useCallback(() => setReceipt(null), []);

  return { receipt, show, retry, clear };
}
