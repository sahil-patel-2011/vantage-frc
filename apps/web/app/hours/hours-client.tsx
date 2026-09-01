"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AiInsightPanel } from "../../components/ai-insight-panel";
import {
  HOUR_KIND_LABELS,
  HOUR_KINDS,
  memberLeaderboard,
  recordHours,
  summarizeHours,
  type BuildHoursView,
  type HourKind,
  type HourLog,
} from "../../lib/build-hours";
import type { KioskScanResult } from "../../lib/hours/kiosk";
import {
  offlineQueueSupported,
  pendingClockCount,
  queueClockEvent,
  syncClockOutbox,
} from "../../lib/hours/kiosk-offline";
import { ENROLL_SCAN_ACTION } from "../../lib/hours/enroll";
import {
  SCAN_CODE_KIND_LABELS,
  newClientEventId,
  normalizeScanCode,
  scanCodeProblem,
  scanCodeProblemMessage,
  scanFeedbackMessage,
} from "../../lib/hours/scan-codes";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type ActionBody = Record<string, unknown> & { action: string; orgId: string };
type ReadyView = Extract<BuildHoursView, { status: "ready" }>;

function fmtHours(value: number): string {
  return `${value % 1 === 0 ? value : value.toFixed(2)}h`;
}
function fmtClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function elapsedLabel(clockIn: string, now: number): string {
  const ms = now - new Date(clockIn).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "0:00";
  const totalMinutes = Math.floor(ms / 60_000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Manual entry + policy forms
// ---------------------------------------------------------------------------

function ManualEntryForm({
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
  run: (body: ActionBody, key: string) => Promise<boolean | void>;
}) {
  const [userId, setUserId] = useState("");
  const [kind, setKind] = useState<HourKind>("build");
  const [clockIn, setClockIn] = useState("");
  const [clockOut, setClockOut] = useState("");
  const [note, setNote] = useState("");

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
          },
          "manual",
        ).then(() => {
          setClockIn("");
          setClockOut("");
          setNote("");
        });
      }}
    >
      <h3>Add hours manually</h3>
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
          <input type="datetime-local" value={clockIn} disabled={busy} onChange={(e) => setClockIn(e.target.value)} />
        </label>
        <label className="hours-field">
          <span>To</span>
          <input type="datetime-local" value={clockOut} disabled={busy} onChange={(e) => setClockOut(e.target.value)} />
        </label>
        <label className="hours-field">
          <span>Note</span>
          <input value={note} disabled={busy} placeholder="Optional" onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <button type="submit" className="app-button secondary" disabled={busy || !clockIn || !clockOut}>
        Add entry
      </button>
    </form>
  );
}

function EnrollScanForm({
  orgId,
  members,
  busy,
  run,
}: {
  orgId: string;
  members: ReadyView["members"];
  busy: boolean;
  run: (body: ActionBody, key: string) => Promise<boolean | void>;
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
      <button type="submit" className="app-button secondary" disabled={busy || !userId || !code.trim()}>
        Enroll card
      </button>
    </form>
  );
}

function PolicyForm({
  orgId,
  policy,
  busy,
  run,
}: {
  orgId: string;
  policy: ReadyView["policy"];
  busy: boolean;
  run: (body: ActionBody, key: string) => Promise<boolean | void>;
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
      <button type="submit" className="app-button secondary" disabled={busy}>
        Save settings
      </button>
    </form>
  );
}

function ScanClockForm({
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

  useEffect(() => {
    focusField();
  }, [focusField]);

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
        Barcode, student ID, or RFID — a USB scanner types into this field and presses Enter. One scan clocks in;
        the next scan from the same card clocks out. Manual clock buttons below are a fallback for members without a
        card.
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
      <button type="submit" className="hours-big-btn" disabled={busy || !code.trim()}>
        Scan
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export default function HoursClient() {
  const [view, setView] = useState<BuildHoursView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [kind, setKind] = useState<HourKind>("build");
  const [now, setNow] = useState(() => Date.now());
  const [showMyLog, setShowMyLog] = useState(false);
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(true);

  // Live tick so open-session timers and the leaderboard stay current.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const load = useCallback(async () => {
    setFetchFailed(false);
    setErrorStatus(null);
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get("orgId");
    try {
      const response = await fetch(`/api/hours${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`);
      const data = (await response.json()) as BuildHoursView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setError("error" in data && data.error ? data.error : "Could not load build hours.");
        setErrorStatus(response.status);
        setFetchFailed(true);
        return;
      }
      setError("");
      setView(data);
      setNow(Date.now());
    } catch {
      setFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (body: ActionBody, key: string) => {
      setBusyKey(key);
      setError("");
      try {
        const response = await fetch("/api/hours", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await response.json()) as { error?: string };
        if (!response.ok) {
          setError(data.error ?? "Action failed.");
          return false;
        }
        await load();
        return true;
      } catch {
        setError("Network error — changes were not saved.");
        return false;
      } finally {
        setBusyKey(null);
      }
    },
    [load],
  );

  const orgIdForQueue = view?.status === "ready" ? view.context.orgId ?? "" : "";

  const refreshPending = useCallback(async () => {
    if (!offlineQueueSupported()) return;
    try {
      setPending(await pendingClockCount(orgIdForQueue || undefined));
    } catch {
      /* locked-down browser without IndexedDB just shows 0 */
    }
  }, [orgIdForQueue]);

  const drain = useCallback(async () => {
    if (!orgIdForQueue || !offlineQueueSupported()) return;
    try {
      const result = await syncClockOutbox(orgIdForQueue);
      setPending(result.remaining);
      if (result.synced > 0) {
        setError(`Synced ${result.synced} queued scan${result.synced === 1 ? "" : "s"}.`);
        await load();
      } else if (result.rejected.length) {
        setError(result.rejected[0]!.reason);
      }
    } catch {
      /* still offline — the queue stays put */
    }
  }, [load, orgIdForQueue]);

  useEffect(() => {
    const update = () => {
      const isOnline = typeof navigator === "undefined" ? true : navigator.onLine !== false;
      setOnline(isOnline);
      if (isOnline) void drain();
    };
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, [drain]);

  useEffect(() => {
    void refreshPending();
  }, [refreshPending]);

  if (fetchFailed || !view) {
    return (
      <main className="module-page hours-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Team / Build Hours</span>
            <h1>Build Hours</h1>
          </div>
        </header>
        <div className="app-card hours-empty">
          {fetchFailed ? (
            (() => {
              // Retry cannot fix an expired session, so the failure picks its own action.
              const copy = loadFailureCopy(
                classifyLoadFailure({
                  status: errorStatus,
                  message: error,
                  online: typeof navigator === "undefined" ? true : navigator.onLine,
                }),
                {
                  nextPath:
                    typeof window === "undefined"
                      ? null
                      : `${window.location.pathname}${window.location.search}`,
                  message: error || "Check your connection and try again.",
                },
              );
              return (
                <>
                  <strong>{copy.title}</strong>
                  <p className="app-muted">{copy.description}</p>
                  {copy.primary ? (
                    <a className="app-button" href={copy.primary.href}>
                      {copy.primary.label}
                    </a>
                  ) : null}
                  {copy.showRetry ? (
                    <button type="button" className="app-button secondary" onClick={() => void load()}>
                      Retry
                    </button>
                  ) : null}
                </>
              );
            })()
          ) : (
            <p className="app-muted">Loading build hours…</p>
          )}
        </div>
      </main>
    );
  }

  if (view.status === "setup_required") {
    return (
      <main className="module-page hours-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Team / Build Hours</span>
            <h1>Build Hours</h1>
            <p>Clock in and out of the shop, see who's here, and track hour goals.</p>
          </div>
        </header>
        <div className="app-card hours-empty">
          <strong>Select a team workspace</strong>
          <p className="app-muted">{view.message}</p>
          <a className="app-button" href="/workspace">
            Choose workspace
          </a>
        </div>
      </main>
    );
  }

  const { context, records, policy, members } = view;
  const orgId = context.orgId ?? "";
  const selfId = context.userId ?? "";
  const canAdmin = context.role === "owner" || context.role === "admin";

  const summary = summarizeHours(records, now);
  const board = memberLeaderboard(records, members, policy.seasonGoalHours, now);
  const myRow = board.find((row) => row.userId === selfId);
  const myOpen = records.find((record) => record.userId === selfId && record.clockOut == null) ?? null;
  const hereNow = records.filter((record) => record.clockOut == null);
  const myRecords = records.filter((record) => record.userId === selfId);
  const busy = busyKey != null;

  const recordLine = (record: HourLog, showName: boolean) => (
    <li key={record.id} className={record.clockOut == null ? "open" : undefined}>
      <span className="session">
        <strong>
          {showName ? `${record.userName ?? "Member"} · ` : ""}
          {fmtClock(record.clockIn)}
          {record.clockOut ? ` → ${fmtClock(record.clockOut)}` : " → now"}
        </strong>
        {record.note ? <small>{record.note}</small> : null}
      </span>
      <span className="hours-kind">{HOUR_KIND_LABELS[record.kind]}</span>
      <b className="dur">{fmtHours(recordHours(record, now))}</b>
      <button
        type="button"
        className="hours-link danger"
        aria-label="Delete entry"
        disabled={busy}
        onClick={() => {
          if (confirm("Delete this hours entry?")) {
            void run({ action: "delete_record", orgId, id: record.id }, `del:${record.id}`);
          }
        }}
      >
        ✕
      </button>
    </li>
  );

  return (
    <main className="module-page hours-page">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">Team / Build Hours</span>
          <h1>Build Hours</h1>
          <p>
            Shop-time tracking for {context.orgName ?? "your team"}
            {context.teamNumber ? ` (Team ${context.teamNumber})` : ""}
            {policy.seasonGoalHours > 0 ? ` · season goal ${fmtHours(policy.seasonGoalHours)} per member` : ""}.
          </p>
        </div>
        <div className="hours-header-actions">
          <a className="app-button secondary" href={orgId ? `/hours/kiosk?orgId=${encodeURIComponent(orgId)}` : "/hours/kiosk"}>
            Shop kiosk
          </a>
          {pending > 0 ? (
            <button type="button" className="app-button secondary" disabled={busy || !online} onClick={() => void drain()}>
              Sync {pending} queued scan{pending === 1 ? "" : "s"}
            </button>
          ) : null}
          {orgId ? (
            <a
              className="app-button secondary"
              href={`/api/hours/export?orgId=${encodeURIComponent(orgId)}`}
              // Mentors get the team's log; a member gets their own. The server decides.
              title={canAdmin ? "Download the team's hours as CSV" : "Download your hours as CSV"}
            >
              Export CSV
            </a>
          ) : null}
          {canAdmin && summary.hereNow > 0 ? (
            <button
              type="button"
              className="app-button secondary"
              disabled={busy}
              onClick={() => {
                if (
                  confirm(
                    `Sign out all ${summary.hereNow} clocked-in member(s)? Sessions left open from an earlier day are capped at your team's auto-close credit instead of being signed out now.`,
                  )
                ) {
                  void run({ action: "close_all_open", orgId }, "close-all");
                }
              }}
            >
              End meeting (sign all out)
            </button>
          ) : null}
        </div>
      </header>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <section className="app-card hours-clock-card" aria-label="Scan a card or clock in">
        <ScanClockForm
          orgId={orgId}
          kind={kind}
          setKind={setKind}
          busy={busy}
          onBusy={(next) => setBusyKey(next ? "scan" : null)}
          onMessage={(message) => {
            setError(message);
            void refreshPending();
          }}
          onSynced={async () => {
            await load();
            await refreshPending();
          }}
        />
      </section>
      {!online ? (
        <p className="hours-kiosk-hint app-muted" role="status">
          Offline — scans are queued on this device with the time they happened. Totals below stay at the last
          loaded records; they are not guessed while the queue drains.
        </p>
      ) : null}

      <section className="app-card hours-clock-card" aria-label="Clock in or out">
        <div className="hours-clock-state">
          {myOpen ? (
            <>
              <strong>
                You're clocked in <span className="elapsed">· {elapsedLabel(myOpen.clockIn, now)}</span>
              </strong>
              <span>
                Since {fmtClock(myOpen.clockIn)} · {HOUR_KIND_LABELS[myOpen.kind]}
              </span>
            </>
          ) : (
            <>
              <strong>You're not clocked in</strong>
              <span>
                {myRow ? `${fmtHours(myRow.totalHours)} logged this season` : "No hours logged yet"}
                {myRow?.goalPercent != null ? ` · ${myRow.goalPercent}% of goal` : ""}
              </span>
            </>
          )}
        </div>
        <div className="hours-clock-actions">
          {!myOpen ? (
            <>
              <select value={kind} disabled={busy} aria-label="Session kind" onChange={(e) => setKind(e.target.value as HourKind)}>
                {HOUR_KINDS.map((value) => (
                  <option key={value} value={value}>
                    {HOUR_KIND_LABELS[value]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="hours-big-btn"
                disabled={busy}
                onClick={() => void run({ action: "clock_in", orgId, kind }, "clock")}
              >
                Clock in
              </button>
            </>
          ) : (
            <button
              type="button"
              className="hours-big-btn out"
              disabled={busy}
              onClick={() => void run({ action: "clock_out", orgId }, "clock")}
            >
              Clock out
            </button>
          )}
        </div>
      </section>

      <div className="hours-summary">
        <div className="hours-summary-tile live">
          <strong>{summary.hereNow}</strong>
          <span>here now</span>
        </div>
        <div className="hours-summary-tile">
          <strong>{fmtHours(summary.totalHours)}</strong>
          <span>team total</span>
        </div>
        <div className="hours-summary-tile">
          <strong>{summary.activeMembers}</strong>
          <span>members logging</span>
        </div>
        <div className="hours-summary-tile">
          <strong>{summary.avgHours == null ? "—" : fmtHours(summary.avgHours)}</strong>
          <span>avg / member</span>
        </div>
      </div>

      <div className="hours-layout">
        <section className="hours-panel">
          <h2>Leaderboard</h2>
          <ol className="hours-board">
            {board.map((row, index) => (
              <li key={row.userId} className={row.userId === selfId ? "me" : undefined}>
                <span className="rank">{index + 1}</span>
                <span className="who">
                  <strong>{row.name ?? "Member"}</strong>
                  {row.openRecordId ? <em>● IN</em> : null}
                </span>
                <span className="total">
                  {fmtHours(row.totalHours)}
                  {row.goalPercent != null ? ` · ${row.goalPercent}%` : ""}
                </span>
                {row.goalPercent != null ? (
                  <span className="goal-track" aria-hidden="true">
                    <i className={row.goalPercent >= 100 ? "done" : undefined} style={{ width: `${row.goalPercent}%` }} />
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
          {hereNow.length > 0 ? (
            <>
              <h2>In the shop right now</h2>
              <ul className="hours-here">
                {hereNow.map((record) => (
                  <li key={record.id}>
                    <span>
                      {record.userName ?? "Member"} · {HOUR_KIND_LABELS[record.kind]}
                    </span>
                    <span>
                      <b>{elapsedLabel(record.clockIn, now)}</b>
                      {canAdmin || record.userId === selfId ? (
                        <>
                          {" "}
                          <button
                            type="button"
                            className="hours-link"
                            disabled={busy}
                            onClick={() => void run({ action: "clock_out", orgId, recordId: record.id }, `out:${record.id}`)}
                          >
                            Sign out
                          </button>
                        </>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>

        <section className="hours-panel">
          <div className="hours-forms">
            <ManualEntryForm orgId={orgId} members={members} canAdmin={canAdmin} selfId={selfId} busy={busyKey === "manual"} run={run} />
            {canAdmin ? (
              <EnrollScanForm orgId={orgId} members={members} busy={busyKey === "enroll"} run={run} />
            ) : null}
            {canAdmin ? <PolicyForm orgId={orgId} policy={policy} busy={busyKey === "policy"} run={run} /> : null}
          </div>
          <h2>
            {showMyLog ? "My entries" : "Recent entries"}{" "}
            <button type="button" className="hours-link" onClick={() => setShowMyLog((value) => !value)}>
              {showMyLog ? "Show all" : "Show mine"}
            </button>
          </h2>
          <ul className="hours-log">
            {(showMyLog ? myRecords : records).slice(0, 25).map((record) => recordLine(record, !showMyLog))}
          </ul>
          {(showMyLog ? myRecords : records).length === 0 ? (
            <p className="app-muted">No entries yet — clock in or add hours manually.</p>
          ) : null}
        </section>
      </div>

      <AiInsightPanel
        orgId={orgId}
        kind="engagement_digest"
        title="Engagement digest"
        description="Mentor's read on participation — top contributors, goal progress, and who needs a check-in."
      />
    </main>
  );
}
