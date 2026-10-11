/**
 * The receipt a scout reads after Save, decided from where the entry actually is.
 *
 * The quick screens used to show "Sent to your team." whenever a sync finished without
 * setting anything aside. A sync that got a 403 (View only), a 401 (signed out), a 5xx or no
 * answer at all also "finished": the entry stayed on the phone and the receipt still said
 * Sent. A 14-year-old reads that line and walks away from the phone. "Sent" now means one
 * thing: the server acknowledged this entry and it left the phone's outbox.
 *
 * Pure, so it is tested; the outbox lookup is in lib/scout-offline.ts (outboxEntryState).
 */

import type { OutboxFailureKind } from "./outbox-chunk";

export type ReceiptSync =
  /** Saved on the phone; the send is in flight. */
  | "sending"
  /** Acknowledged by the server and gone from this phone's outbox. */
  | "sent"
  /** No signal: it goes when the phone is back online. */
  | "waiting"
  /** Still queued with no failure reported (another send was already running). */
  | "queued"
  /** Online, but the server did not answer or answered with an error. */
  | "unreachable"
  /** The server answered 401: retrying cannot help until the scout signs in again. */
  | "signed-out"
  /** The server refused this entry; it is set aside under Needs a look with the reason. */
  | "refused";

export type ReceiptStatus = { sync: ReceiptSync; reason?: string | null };

export type OutboxEntryState = { state: "queued" } | { state: "set-aside"; reason: string } | { state: "gone" };

export function receiptAfterSync(input: {
  state: OutboxEntryState;
  failure: OutboxFailureKind | null;
  online: boolean;
}): ReceiptStatus {
  if (input.state.state === "gone") return { sync: "sent" };
  if (input.state.state === "set-aside") return { sync: "refused", reason: input.state.reason };
  if (!input.online) return { sync: "waiting" };
  if (input.failure === "signed-out") return { sync: "signed-out" };
  if (input.failure === "server" || input.failure === "unreachable") return { sync: "unreachable" };
  return { sync: "queued" };
}

/** The sentence under "Saved …", and how loud it is. */
export function receiptLine(status: ReceiptStatus): { text: string; tone: "done" | "pending" | "problem" } {
  switch (status.sync) {
    case "sent":
      return { text: "Sent to your team.", tone: "done" };
    case "sending":
      return { text: "Sending to your team…", tone: "pending" };
    case "waiting":
      return { text: "Saved on this phone, not sent yet: there is no signal. It sends itself when the signal is back.", tone: "pending" };
    case "queued":
      return { text: "Saved on this phone, not sent yet. It sends itself in a moment.", tone: "pending" };
    case "unreachable":
      return {
        text: "Saved on this phone, not sent yet: your team’s server didn’t answer. It keeps trying by itself.",
        tone: "pending",
      };
    case "signed-out":
      return { text: "Saved on this phone, not sent: you are signed out. Sign in again and it sends itself.", tone: "problem" };
    case "refused": {
      const reason = status.reason?.trim();
      return {
        text: reason
          ? `Saved on this phone, but your team didn’t accept it. ${/[.!?]$/.test(reason) ? reason : `${reason}.`}`
          : "Saved on this phone, but your team didn’t accept it.",
        tone: "problem",
      };
    }
  }
}
