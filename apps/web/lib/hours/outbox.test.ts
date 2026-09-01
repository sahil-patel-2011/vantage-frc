import { describe, expect, it } from "vitest";
import {
  clockScanRequestBody,
  createQueuedClockEvent,
  isPermanentClockStatus,
  orderClockOutbox,
  type QueuedClockEvent,
} from "./outbox";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function event(overrides: Partial<QueuedClockEvent> = {}): QueuedClockEvent {
  return {
    clientId: "aaaaaaaa-1111-4111-8111-111111111111",
    orgId: ORG,
    code: "A12345",
    kind: "build",
    occurredAt: "2026-02-14T18:02:00.000Z",
    displayName: "Maya",
    queuedAt: "2026-02-14T18:02:01.000Z",
    ...overrides,
  };
}

describe("createQueuedClockEvent", () => {
  it("captures the scan time instead of leaving occurredAt blank for drain to invent", () => {
    const scanned = "2026-02-14T18:02:00.000Z";
    const queued = createQueuedClockEvent({
      orgId: ORG,
      code: "A12345",
      kind: "build",
      occurredAt: scanned,
      clientId: "keep-this-id-please",
    });
    expect(queued.occurredAt).toBe(scanned);
    expect(queued.clientId).toBe("keep-this-id-please");
    expect(queued).not.toHaveProperty("elapsedHours");
    expect(queued).not.toHaveProperty("totalHours");
  });

  it("reuses a caller-supplied clientId so a lost response cannot toggle twice", () => {
    const first = createQueuedClockEvent({
      orgId: ORG,
      code: "A12345",
      kind: "build",
      clientId: "same-scan-id-xxxxxxxx",
    });
    const retry = createQueuedClockEvent({
      orgId: ORG,
      code: "A12345",
      kind: "build",
      clientId: "same-scan-id-xxxxxxxx",
    });
    expect(retry.clientId).toBe(first.clientId);
  });

  it("refuses to queue without an org or a code", () => {
    expect(() => createQueuedClockEvent({ orgId: "", code: "A12345", kind: "build" })).toThrow(/orgId/i);
    expect(() => createQueuedClockEvent({ orgId: ORG, code: "", kind: "build" })).toThrow(/code/i);
  });
});

describe("clockScanRequestBody", () => {
  it("drains the captured scan time and id — never Date.now() or a new toggle key", () => {
    const queued = event();
    const body = clockScanRequestBody(queued);
    expect(body).toEqual({
      action: "scan",
      orgId: ORG,
      code: "A12345",
      kind: "build",
      occurredAt: "2026-02-14T18:02:00.000Z",
      clientEventId: "aaaaaaaa-1111-4111-8111-111111111111",
    });
  });

  it("does not invent elapsed hours, DEMO totals, or a clock-out", () => {
    const body = clockScanRequestBody(event());
    expect(body).not.toHaveProperty("elapsedHours");
    expect(body).not.toHaveProperty("totalHours");
    expect(body).not.toHaveProperty("clockOut");
    expect(JSON.stringify(body)).not.toMatch(/DEMO/i);
  });

  it("refuses a row that is missing the evidence needed to write a real session", () => {
    expect(() => clockScanRequestBody(event({ occurredAt: "" }))).toThrow(/invent a scan time/i);
    expect(() => clockScanRequestBody(event({ clientId: "" }))).toThrow(/mint a new toggle id/i);
    expect(() => clockScanRequestBody(event({ orgId: "" }))).toThrow(/orgId/i);
  });
});

describe("orderClockOutbox", () => {
  it("replays oldest scan first so a two-hour outage does not burst at reconnect", () => {
    const later = event({ clientId: "b", occurredAt: "2026-02-14T20:31:00.000Z" });
    const earlier = event({ clientId: "a", occurredAt: "2026-02-14T18:02:00.000Z" });
    expect(orderClockOutbox([later, earlier]).map((row) => row.clientId)).toEqual(["a", "b"]);
  });

  it("does not leak another org's scans into this drain", () => {
    const mine = event({ clientId: "mine", orgId: ORG });
    const theirs = event({ clientId: "theirs", orgId: OTHER });
    const scoped = orderClockOutbox([mine, theirs].filter((row) => row.orgId === ORG));
    expect(scoped.map((row) => row.clientId)).toEqual(["mine"]);
  });
});

describe("isPermanentClockStatus", () => {
  it("treats unknown-card and auth failures as permanent", () => {
    expect(isPermanentClockStatus(400)).toBe(true);
    expect(isPermanentClockStatus(403)).toBe(true);
    expect(isPermanentClockStatus(404)).toBe(true);
  });

  it("retries timeouts, rate limits, and 5xx instead of dropping attendance", () => {
    expect(isPermanentClockStatus(408)).toBe(false);
    expect(isPermanentClockStatus(429)).toBe(false);
    expect(isPermanentClockStatus(500)).toBe(false);
    expect(isPermanentClockStatus(503)).toBe(false);
  });
});
