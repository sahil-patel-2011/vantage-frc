/**
 * Clock-scan outbox contract — framework-free so drain behavior is unit-testable
 * without IndexedDB or fetch.
 *
 * A shop tablet with dead Wi-Fi still has to take attendance. The recorded time
 * must be when the student scanned, not when the network came back, and a retry
 * must reuse the same idempotency key so the server does not toggle the member
 * twice. This module is the honesty gate: it never invents elapsed hours, DEMO
 * totals, or a fresh scan time at drain.
 */

import { newClientEventId } from "./scan-codes";

export type QueuedClockEvent = {
  /**
   * Idempotency key AND IndexedDB primary key. Stable across every retry of this
   * scan — and carried over from a failed online attempt — so the server can
   * tell a replay from a genuinely new sign-in.
   */
  clientId: string;
  orgId: string;
  /** Normalized scan code — the server resolves it to a member. */
  code: string;
  kind: string;
  /** When the student actually scanned. Sent as `occurredAt`. */
  occurredAt: string;
  /** Optimistic label so the pending list reads as names, not codes. */
  displayName: string | null;
  queuedAt: string;
  /** Populated when the server permanently rejected the event. */
  lastError?: string;
};

export type ClockScanRequestBody = {
  action: "scan";
  orgId: string;
  code: string;
  kind: string;
  occurredAt: string;
  clientEventId: string;
};

/**
 * Body posted when draining one queued scan.
 *
 * `occurredAt` is the captured scan time — never `Date.now()`. `clientEventId`
 * is the same id the failed online attempt already sent. Elapsed hours and
 * member totals are omitted: the server derives those from real `hour_logs`
 * rows, and inventing them here would fabricate attendance.
 */
export function clockScanRequestBody(event: QueuedClockEvent): ClockScanRequestBody {
  if (!event.orgId) throw new Error("orgId is required to drain a clock event");
  if (!event.code) throw new Error("code is required to drain a clock event");
  if (!event.occurredAt) throw new Error("occurredAt is required — refusing to invent a scan time");
  if (!event.clientId) throw new Error("clientId is required — refusing to mint a new toggle id");
  return {
    action: "scan",
    orgId: event.orgId,
    code: event.code,
    kind: event.kind,
    occurredAt: event.occurredAt,
    clientEventId: event.clientId,
  };
}

/** Oldest scan first — attendance must replay in the order it happened. */
export function orderClockOutbox(events: readonly QueuedClockEvent[]): QueuedClockEvent[] {
  return [...events].sort(
    (a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.clientId.localeCompare(b.clientId),
  );
}

/** A 4xx will never succeed on retry — surface it instead of looping forever. */
export function isPermanentClockStatus(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

export function createQueuedClockEvent(input: {
  orgId: string;
  code: string;
  kind: string;
  displayName?: string | null;
  occurredAt?: string;
  /**
   * Reuse the id the failed online attempt already sent. That request may have
   * been committed before the response was lost, so the queued copy has to be
   * recognisable as the SAME scan or the replay toggles the member twice.
   */
  clientId?: string;
}): QueuedClockEvent {
  if (!input.orgId) throw new Error("orgId is required to queue a clock event");
  if (!input.code) throw new Error("code is required to queue a clock event");
  return {
    clientId: input.clientId ?? newClientEventId(),
    orgId: input.orgId,
    code: input.code,
    kind: input.kind,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    displayName: input.displayName ?? null,
    queuedAt: new Date().toISOString(),
  };
}
