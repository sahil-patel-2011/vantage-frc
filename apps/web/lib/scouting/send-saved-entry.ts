"use client";

import { outboxEntryState, syncOutbox } from "../scout-offline";
import type { OutboxFailureKind } from "./outbox-chunk";
import { receiptAfterSync, type ReceiptStatus } from "./sync-receipt";

/**
 * Send the outbox right after a Save and say what happened to *that* entry.
 *
 * A second pass covers the case where the frame's own background send was already running
 * when Save queued the entry: joining it returns without this entry having been sent.
 */
export async function sendSavedEntry(orgId: string, clientId: string): Promise<ReceiptStatus> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { sync: "waiting" };
  let status: ReceiptStatus = { sync: "queued" };
  for (let pass = 0; pass < 2; pass += 1) {
    const failure: OutboxFailureKind | null = await syncOutbox(orgId, { maxAttempts: 3 }).then(
      (result) => result.failure,
      () => "unreachable" as const,
    );
    const state = await outboxEntryState(orgId, clientId).catch(() => ({ state: "queued" as const }));
    status = receiptAfterSync({ state, failure, online: typeof navigator === "undefined" ? true : navigator.onLine !== false });
    if (status.sync !== "queued") return status;
  }
  return status;
}

/** Look again without sending: the frame's background send may have delivered it since. */
export async function recheckSavedEntry(orgId: string, clientId: string, current: ReceiptStatus): Promise<ReceiptStatus> {
  const state = await outboxEntryState(orgId, clientId).catch(() => null);
  if (!state) return current;
  if (state.state === "gone") return { sync: "sent" };
  if (state.state === "set-aside") return { sync: "refused", reason: state.reason };
  return current;
}
