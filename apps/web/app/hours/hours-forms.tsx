"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui";
import { HOUR_KIND_LABELS, HOUR_KINDS, type HourKind } from "../../lib/build-hours";
import type { KioskScanResult } from "../../lib/hours/kiosk";
import { offlineQueueSupported, queueClockEvent } from "../../lib/hours/kiosk-offline";
import { ENROLL_SCAN_ACTION } from "../../lib/hours/enroll";
import {
  SCAN_CODE_KIND_LABELS,
  newClientEventId,
  normalizeScanCode,
  scanCodeProblem,
  scanCodeProblemMessage,
  scanFeedbackMessage,
} from "../../lib/hours/scan-codes";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { fmtClock, toLocalInputValue, type HourLog, type HoursRun, type ReadyView } from "./hours-model";

function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/**
 * A mentor fixes an entry's times in place (a forgotten clock-out, a typo in a typed-in session)
 * instead of deleting it and adding it again. The note is required and is kept with the entry,
 * together with the times it replaced (0723).
 */
export function EditTimesForm({
  orgId,
  record,
  busy,
  run,
  onDone,
}: {
  orgId: string;
  record: HourLog;
  busy: boolean;
  run: HoursRun;
  onDone: () => void;
}) {
  const [clockIn, setClockIn] = useState(() => toLocalInputValue(record.clockIn));
  const [clockOut, setClockOut] = useState(() => (record.clockOut ? toLocalInputValue(record.clockOut) : ""));
  const [note, setNote] = useState("");
  const latest = toLocalInputValue(new Date().toISOString());
  const ready = Boolean(clockIn && clockOut && note.trim().length >= 3);

  return (
    <form
      className="hours-manual hours-edit"
      aria-label={`Edit times for ${record.userName ?? "this member"}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        void run(
          { action: "correct_record", orgId, id: record.id, clockIn, clockOut, note: note.trim(), timeZone: browserTimeZone() },
          `edit:${record.id}`,
        ).then((ok) => {
          if (ok !== false) onDone();
        });
      }}
    >
      <p className="hours-kiosk-hint app-muted">
        Now: {fmtClock(record.clockIn)}
        {record.clockOut ? ` → ${fmtClock(record.clockOut)}` : " → still clocked in"}. Your note is saved with the entry.
      </p>
      <div className="hours-form-grid">
        <label className="hours-field">
          <span>From</span>
          <input type="datetime-local" value={clockIn} max={latest} disabled={busy} required onChange={(e) => setClockIn(e.target.value)} />
        </label>
        <label className="hours-field">
          <span>To</span>
          <input type="datetime-local" value={clockOut} min={clockIn || undefined} max={latest} disabled={busy} required onChange={(e) => setClockOut(e.target.value)} />
        </label>
        <label className="hours-field hours-field-wide">
          <span>Why the change</span>
          <input
            value={note}
            disabled={busy}
            required
            minLength={3}
            maxLength={250}
            placeholder="Forgot to clock out at 6 PM"
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      </div>
      <div className="hours-edit-actions">
        <Button variant="secondary" type="button" disabled={busy} onClick={onDone}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" disabled={busy || !ready}>
          Save times
        </Button>
      </div>
    </form>
  );
}

export function ManualEntryForm({
  orgId,
  members,
  canAdmin,
  selfId,
  busy,
  run,
}: {
  orgId: string;
  members: ReadyView["members"];
  canAdmin: boolean;
  selfId: string;
  busy: boolean;
  run: HoursRun;
}) {
  const [userId, setUserId] = useState("");
  const [kind, setKind] = useState<HourKind>("build");
  const [clockIn, setClockIn] = useState("");
  const [clockOut, setClockOut] = useState("");
  const [note, setNote] = useState("");
  // The picker stops at now; the server refuses a future session either way.
  const latest = toLocalInputValue(new Date().toISOString());

  return (
    <form
      className="hours-manual"
      onSubmit={(event) => {
        event.preventDefault();
        if (!clockIn || !clockOut) return;
        void run(
          {
            action: "add_manual",
            orgId,
            userId: canAdmin && userId ? userId : null,
            kind,
            clockIn,
            clockOut,
            note: note.trim(),
            timeZone: browserTimeZone(),
          },
          "manual",
        ).then((ok) => {
          // A refused entry (overlap, future) keeps what was typed so it can be fixed.
          if (ok === false) return;
          setClockIn("");
          setClockOut("");
          setNote("");
        });
      }}
    >
      <h3>Add hours manually</h3>
      <p className="hours-kiosk-hint app-muted">
        For a session you forgot to clock. It shows as added by hand, and it can&rsquo;t be in the future or
        overlap hours already logged.
      </p>
      <div className="hours-form-grid">
        {canAdmin ? (
          <label className="hours-field">
            <span>Member</span>
            <select value={userId} disabled={busy} onChange={(e) => setUserId(e.target.value)}>
              <option value="">Myself</option>
              {members
                .filter((member) => member.userId !== selfId)
                .map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.name ?? "Member"}
                  </option>
                ))}
            </select>
          </label>
        ) : null}
        <label className="hours-field">
          <span>Kind</span>
          <select value={kind} disabled={busy} onChange={(e) => setKind(e.target.value as HourKind)}>
            {HOUR_KINDS.map((value) => (
              <option key={value} value={value}>
                {HOUR_KIND_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="hours-field">
          <span>From</span>
          <input type="datetime-local" value={clockIn} max={latest} disabled={busy} onChange={(e) => setClockIn(e.target.value)} />
        </label>
        <label className="hours-field">
          <span>To</span>
          <input type="datetime-local" value={clockOut} min={clockIn || undefined} max={latest} disabled={busy} onChange={(e) => setClockOut(e.target.value)} />
        </label>
        <label className="hours-field">
          <span>Note</span>
          <input value={note} disabled={busy} placeholder="Optional" onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <Button variant="secondary" type="submit" disabled={busy || !clockIn || !clockOut}>
        Add entry
      </Button>
    </form>
  );
}

export function EnrollScanForm({
  orgId,
  members,
  busy,
  run,
}: {
  orgId: string;
  members: ReadyView["members"];
  busy: boolean;
  run: HoursRun;
}) {
  const [userId, setUserId] = useState("");
  const [code, setCode] = useState("");
  const [codeKind, setCodeKind] = useState<keyof typeof SCAN_CODE_KIND_LABELS>("student_id");
  const [label, setLabel] = useState("");

  return (
    <form
      className="hours-manual"
      onSubmit={(event) => {
        event.preventDefault();
        if (!userId || !code.trim()) return;
        void run(
          { action: ENROLL_SCAN_ACTION, orgId, userId, code, codeKind, label: label.trim() },
          "enroll",
        ).then((ok) => {
          if (ok) {
            setCode("");
            setLabel("");
          }
        });
      }}
    >
      <h3>Enroll a scan card (owner/admin)</h3>
      <p className="hours-kiosk-hint app-muted">
        Attach a barcode, student ID, or RFID fob to a member so they can scan in at the shop kiosk. Use
        whatever the reader types — never an email address.
      </p>
      <div className="hours-form-grid">
        <label className="hours-field">
          <span>Member</span>
          <select value={userId} disabled={busy} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Choose a member…</option>
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.name ?? "Member"}
              </option>
            ))}
          </select>
        </label>
        <label className="hours-field">
          <span>Scan or type the code</span>
          <input
            value={code}
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
            placeholder="Scan the card here"
            onChange={(e) => setCode(e.target.value)}
          />
        </label>
        <label className="hours-field">
          <span>Kind</span>
          <select
            value={codeKind}
            disabled={busy}
            onChange={(e) => setCodeKind(e.target.value as keyof typeof SCAN_CODE_KIND_LABELS)}
          >
            {Object.entries(SCAN_CODE_KIND_LABELS).map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        </label>
        <label className="hours-field">
          <span>Label (optional)</span>
          <input
            value={label}
            disabled={busy}
            placeholder="blue lanyard card"
            maxLength={80}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
      </div>
      <Button variant="secondary" type="submit" disabled={busy || !userId || !code.trim()}>
        Enroll card
      </Button>
    </form>
  );
}

export function PolicyForm({
  orgId,
  policy,
  busy,
  run,
}: {
  orgId: string;
  policy: ReadyView["policy"];
  busy: boolean;
  run: HoursRun;
}) {
  const [goal, setGoal] = useState(policy.seasonGoalHours ? String(policy.seasonGoalHours) : "");
  const [start, setStart] = useState(policy.seasonStart ?? "");

  useEffect(() => {
    setGoal(policy.seasonGoalHours ? String(policy.seasonGoalHours) : "");
    setStart(policy.seasonStart ?? "");
  }, [policy.seasonGoalHours, policy.seasonStart]);

  return (
    <form
      className="hours-policy"
      onSubmit={(event) => {
        event.preventDefault();
        void run(
          { action: "set_policy", orgId, seasonGoalHours: goal === "" ? 0 : Number(goal), seasonStart: start || null },
          "policy",
        );
      }}
    >
      <h3>Season settings (owner/admin)</h3>
      <div className="hours-form-grid">
        <label className="hours-field">
          <span>Season hour goal</span>
          <input type="number" step="any" min={0} placeholder="e.g. 100" value={goal} disabled={busy} onChange={(e) => setGoal(e.target.value)} />
        </label>
        <label className="hours-field">
          <span>Season start</span>
          <input type="date" value={start} disabled={busy} onChange={(e) => setStart(e.target.value)} />
        </label>
      </div>
      <Button variant="secondary" type="submit" disabled={busy}>
        Save settings
      </Button>
    </form>
  );
}

export function ScanClockForm({
  orgId,
  kind,
  setKind,
  busy,
  onBusy,
  onMessage,
  onSynced,
}: {
  orgId: string;
  kind: HourKind;
  setKind: (kind: HourKind) => void;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onMessage: (message: string) => void;
  onSynced: () => Promise<void>;
}) {
  const [code, setCode] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const focusField = useCallback(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);
  // No focus on page load: on a phone it opened the keyboard over "Clock in", and on Hours
  // the scan field sits below the clock card. After a scan the field is focused again, so a
  // USB scanner can keep going; the full-screen kiosk (/hours/kiosk) focuses it from the start.

  const submit = useCallback(async () => {
    const normalized = normalizeScanCode(code);
    const problem = scanCodeProblem(normalized);
    if (problem) {
      onMessage(scanCodeProblemMessage(problem));
      focusField();
      return;
    }

    onBusy(true);
    const occurredAt = new Date().toISOString();
    const clientEventId = newClientEventId();
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;

    try {
      if (offline && offlineQueueSupported()) {
        await queueClockEvent({ orgId, code: normalized, kind, occurredAt, clientId: clientEventId });
        setCode("");
        onMessage(
          `Scan queued offline at ${new Date(occurredAt).toLocaleTimeString(undefined, {
            hour: "numeric",
            minute: "2-digit",
          })} — it will sync when the network is back.`,
        );
        return;
      }

      const response = await fetch("/api/hours/kiosk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "scan",
          orgId,
          code: normalized,
          kind,
          occurredAt,
          clientEventId,
        }),
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string } & Partial<KioskScanResult>;
      if (!response.ok) {
        const unreachable = typeof navigator !== "undefined" && navigator.onLine === false;
        if (unreachable && offlineQueueSupported()) {
          await queueClockEvent({ orgId, code: normalized, kind, occurredAt, clientId: clientEventId });
          setCode("");
          onMessage("Network dropped — scan queued and will sync automatically.");
          return;
        }
        onMessage(data.error ?? "Scan failed.");
        return;
      }
      if (data.outcome === "in" || data.outcome === "out") {
        onMessage(
          scanFeedbackMessage({
            outcome: data.outcome,
            memberName: data.memberName ?? null,
            at: data.at ?? occurredAt,
            elapsedHours: data.elapsedHours,
          }),
        );
      }
      setCode("");
      await onSynced();
    } catch (error) {
      const unreachable = error instanceof TypeError || (typeof navigator !== "undefined" && navigator.onLine === false);
      if (unreachable && offlineQueueSupported()) {
        try {
          await queueClockEvent({ orgId, code: normalized, kind, occurredAt, clientId: clientEventId });
          setCode("");
          onMessage("Network dropped — scan queued and will sync automatically.");
          return;
        } catch {
          /* fall through */
        }
      }
      onMessage(error instanceof Error ? error.message : "Scan failed.");
    } finally {
      onBusy(false);
      focusField();
    }
  }, [code, focusField, kind, onBusy, onMessage, onSynced, orgId]);

  return (
    <form
      className="hours-manual"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h3>Scan a card</h3>
      <p className="hours-kiosk-hint app-muted">
        For a shop scanner or a student ID card: one scan clocks in, the next scan from the same card clocks out.
        No card? Use Clock in above.
      </p>
      <div className="hours-form-grid">
        <label className="hours-field">
          <span>Barcode / student ID</span>
          <input
            ref={inputRef}
            value={code}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            enterKeyHint="go"
            placeholder="Scan here"
            aria-label="Scan barcode or student ID"
            disabled={busy}
            onChange={(event) => setCode(event.target.value)}
          />
        </label>
        <label className="hours-field">
          <span>Kind</span>
          <select value={kind} disabled={busy} onChange={(event) => setKind(event.target.value as HourKind)}>
            {HOUR_KINDS.map((value) => (
              <option key={value} value={value}>
                {HOUR_KIND_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Button variant="primary" type="submit" className="hours-big-btn" disabled={busy || !code.trim()}>
        Scan
      </Button>
    </form>
  );
}
