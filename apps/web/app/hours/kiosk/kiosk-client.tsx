"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_AUTO_CLOSE_AFTER_HOURS,
  DEFAULT_AUTO_CLOSE_CREDIT_HOURS,
} from "../../../lib/hours/auto-close";
import { eligibilityBoard, summarizeEligibility } from "../../../lib/hours/eligibility";
import type { KioskScanCodeRow, KioskScanResult, KioskView } from "../../../lib/hours/kiosk";
import {
  offlineQueueSupported,
  pendingClockCount,
  queueClockEvent,
  syncClockOutbox,
} from "../../../lib/hours/kiosk-offline";
import {
  SCAN_CODE_KIND_LABELS,
  SCAN_FEEDBACK_MS,
  newClientEventId,
  normalizeScanCode,
  scanCodeProblem,
  scanCodeProblemMessage,
  scanFeedbackMessage,
} from "../../../lib/hours/scan-codes";
import { classifyLoadFailure, loadFailureCopy } from "../../../lib/ui/load-failure";

type Banner = { tone: "in" | "out" | "queued" | "error"; message: string } | null;

function elapsedLabel(clockIn: string, now: number): string {
  const ms = now - new Date(clockIn).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "0:00";
  const totalMinutes = Math.floor(ms / 60_000);
  return `${Math.floor(totalMinutes / 60)}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

/**
 * Shop-door scan-in kiosk.
 *
 * Built for the hardware teams actually own: a $30 USB barcode / student-ID
 * reader is a keyboard-wedge device that types the code into whatever field has
 * focus and presses Enter. So the whole screen is one enormous autofocused
 * input that re-grabs focus after every single action, feedback is one loud
 * line that clears itself, and if the shop Wi-Fi is dead the scan is queued in
 * IndexedDB with the time it actually happened and replayed on reconnect.
 */
export default function KioskClient() {
  const [view, setView] = useState<KioskView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [code, setCode] = useState("");
  const [kind, setKind] = useState("build");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [rejected, setRejected] = useState<Array<{ clientId: string; displayName: string | null; reason: string }>>([]);
  const [sweep, setSweep] = useState("");
  const [panel, setPanel] = useState<"none" | "cards" | "policy">("none");

  const inputRef = useRef<HTMLInputElement | null>(null);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Scans are serialized through this chain instead of being blocked by `busy`.
   * A keyboard-wedge reader fires a whole code in a few milliseconds, so a
   * second student scanning during the first student's round-trip must be
   * buffered and processed in order — never dropped on a disabled field.
   */
  const chain = useRef<Promise<void>>(Promise.resolve());

  /** Focus only. Does NOT clear: a queued scan may already be in the field. */
  const focusField = useCallback(() => {
    // rAF so focus lands after React has finished the re-render.
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  /** Clear + focus, for admin actions that are not mid-scan. */
  const refocus = useCallback(() => {
    setCode("");
    focusField();
  }, [focusField]);

  const flash = useCallback((next: Banner) => {
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    setBanner(next);
    if (next) {
      bannerTimer.current = setTimeout(() => setBanner(null), SCAN_FEEDBACK_MS);
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => () => {
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
  }, []);

  const load = useCallback(async () => {
    setFetchFailed(false);
    setErrorStatus(null);
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get("orgId");
    try {
      const response = await fetch(`/api/hours/kiosk${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`);
      const data = (await response.json()) as KioskView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setError("error" in data && data.error ? data.error : "Could not load the kiosk.");
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
    const timer = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void load();
    }, 60_000);
    return () => clearInterval(timer);
  }, [load]);

  const orgId = view?.status === "ready" ? view.context.orgId ?? "" : "";

  const refreshPending = useCallback(async () => {
    if (!offlineQueueSupported()) return;
    try {
      setPending(await pendingClockCount(orgId || undefined));
    } catch {
      /* a locked-down browser without IndexedDB just shows 0 pending */
    }
  }, [orgId]);

  const drain = useCallback(async () => {
    if (!orgId || !offlineQueueSupported()) return;
    try {
      const result = await syncClockOutbox(orgId);
      setRejected(result.rejected);
      setPending(result.remaining);
      if (result.synced > 0) {
        flash({ tone: "in", message: `Synced ${result.synced} queued scan${result.synced === 1 ? "" : "s"}.` });
        await load();
      }
    } catch {
      /* still offline — the queue stays put */
    }
  }, [orgId, flash, load]);

  // Online/offline tracking drives the banner AND the automatic drain.
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

  // Anywhere-on-screen typing goes to the scan field: a scanner fires into
  // whatever has focus, and a mentor may have clicked a list item.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (event.key.length !== 1) return;
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const post = useCallback(
    async (body: Record<string, unknown>) => {
      const response = await fetch("/api/hours/kiosk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>;
      if (!response.ok) throw new Error(data.error ?? "Kiosk action failed.");
      return data;
    },
    [],
  );

  const runScan = useCallback(
    async (raw: string) => {
      if (!orgId) return;
      const normalized = normalizeScanCode(raw);
      const problem = scanCodeProblem(normalized);
      if (problem) {
        flash({ tone: "error", message: scanCodeProblemMessage(problem) });
        focusField();
        return;
      }

      setBusy(true);
      const occurredAt = new Date().toISOString();
      // One id for this scan, generated BEFORE the attempt and reused if the
      // attempt has to be queued. A scan is a toggle, so if the server committed
      // it and only the response was lost, the queued retry must be recognisable
      // as the same scan — otherwise the sync clocks the student straight back
      // out and invents a session nobody worked.
      const clientEventId = newClientEventId();
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;

      try {
        if (offline && offlineQueueSupported()) {
          await queueClockEvent({ orgId, code: normalized, kind, occurredAt, clientId: clientEventId });
          await refreshPending();
          flash({
            tone: "queued",
            message: `Scan queued offline at ${new Date(occurredAt).toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            })} — it will sync when the network is back.`,
          });
          return;
        }

        const result = (await post({
          action: "scan",
          orgId,
          code: normalized,
          kind,
          occurredAt,
          clientEventId,
        })) as unknown as KioskScanResult;

        flash({
          tone: result.outcome,
          message: scanFeedbackMessage({
            outcome: result.outcome,
            memberName: result.memberName,
            at: result.at,
            elapsedHours: result.elapsedHours,
          }),
        });
        await load();
      } catch (networkOrServerError) {
        const message =
          networkOrServerError instanceof Error ? networkOrServerError.message : "Scan failed.";
        // A fetch that never reached the server (dead venue Wi-Fi mid-scan) must
        // not lose the attendance — queue it rather than dropping it.
        const unreachable =
          networkOrServerError instanceof TypeError ||
          (typeof navigator !== "undefined" && navigator.onLine === false);
        if (unreachable && offlineQueueSupported()) {
          try {
            await queueClockEvent({ orgId, code: normalized, kind, occurredAt, clientId: clientEventId });
            await refreshPending();
            flash({ tone: "queued", message: "Network dropped — scan queued and will sync automatically." });
            return;
          } catch {
            /* fall through to the error banner */
          }
        }
        flash({ tone: "error", message });
      } finally {
        setBusy(false);
        focusField();
      }
    },
    [orgId, kind, post, load, flash, focusField, refreshPending],
  );

  /**
   * Public entry point: queue the scan behind any in-flight one so two students
   * scanning back-to-back both get recorded, in the order they scanned.
   */
  const submitScan = useCallback(
    (raw: string) => {
      // runScan reports its own failures through the banner, so the chain
      // absorbs rejections: one bad scan must never stall the queue behind it
      // or surface as an unhandled rejection on an unattended kiosk.
      const next = chain.current.then(() => runScan(raw)).catch(() => {});
      chain.current = next;
      return next;
    },
    [runScan],
  );

  const runSweep = useCallback(async () => {
    if (!orgId) return;
    setBusy(true);
    try {
      const result = (await post({ action: "auto_close_sweep", orgId })) as { summary?: string };
      setSweep(result.summary ?? "");
      await load();
    } catch (sweepError) {
      setSweep(sweepError instanceof Error ? sweepError.message : "Sweep failed.");
    } finally {
      setBusy(false);
      refocus();
    }
  }, [orgId, post, load, refocus]);

  const board = useMemo(() => {
    if (view?.status !== "ready") return [];
    return eligibilityBoard(view.totals, view.policy.travelEligibilityHours);
  }, [view]);

  const summary = useMemo(
    () =>
      summarizeEligibility(
        board,
        view?.status === "ready" ? view.policy.travelEligibilityHours : null,
      ),
    [board, view],
  );

  if (fetchFailed || !view || view.status === "setup_required") {
    return (
      <main className="module-page hours-page hours-kiosk">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Team / Build Hours / Kiosk</span>
            <h1>Scan-in Kiosk</h1>
          </div>
        </header>
        <div className="app-card hours-empty">
          {view?.status === "setup_required" ? (
            <>
              <strong>Select a team</strong>
              <p className="app-muted">{view.message}</p>
              <a className="app-button" href="/workspace">
                Choose your team
              </a>
            </>
          ) : fetchFailed ? (
            (() => {
              const copy = loadFailureCopy(
                classifyLoadFailure({
                  status: errorStatus,
                  message: error,
                  online: typeof navigator === "undefined" ? true : navigator.onLine,
                }),
                {
                  nextPath:
                    typeof window === "undefined" ? null : `${window.location.pathname}${window.location.search}`,
                  message: error || "Check the connection and try again.",
                },
              );
              return (
                <>
                  <strong>{copy.title}</strong>
                  <p className="app-muted">{copy.description}</p>
                  {errorStatus === 503 && error ? <p className="app-muted">{error}</p> : null}
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
            <p className="app-muted">Loading kiosk…</p>
          )}
        </div>
      </main>
    );
  }

  const { context, policy, openSessions, totals, scanCodes, unenrolledCount } = view;
  const canAdmin = context.role === "owner" || context.role === "admin";
  const nameById = new Map(totals.map((total) => [total.userId, total.name]));

  return (
    <main className="module-page hours-page hours-kiosk kiosk-scan" onClick={() => inputRef.current?.focus()}>
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">Team / Build Hours / Kiosk</span>
          <h1>Scan-in Kiosk</h1>
          <p>
            Scan a card or type an ID and press Enter · {openSessions.length} in the shop right now
            {context.orgName ? ` · ${context.orgName}` : ""}
          </p>
        </div>
        <div className="kiosk-header-actions">
          <a
            className="app-button secondary"
            href={orgId ? `/hours?orgId=${encodeURIComponent(orgId)}` : "/hours"}
          >
            Full hours view
          </a>
        </div>
      </header>

      <div className={online ? "kiosk-net" : "kiosk-net offline"} role="status">
        <span className="dot" aria-hidden="true" />
        <strong>{online ? "Online" : "Offline — scans are being queued on this device"}</strong>
        {pending > 0 ? (
          <span className="kiosk-pending">
            {pending} pending scan{pending === 1 ? "" : "s"}
            {online ? (
              <button type="button" className="kiosk-inline-btn" onClick={() => void drain()}>
                Sync now
              </button>
            ) : null}
          </span>
        ) : null}
        {!offlineQueueSupported() ? (
          <span className="kiosk-pending warn">
            This browser blocks offline storage — scans need a live connection here.
          </span>
        ) : null}
      </div>

      <form
        className="kiosk-scan-form"
        onSubmit={(event) => {
          event.preventDefault();
          // Clear synchronously so the field is empty the instant the next
          // scanner burst arrives, even while this scan is still in flight.
          const raw = code;
          setCode("");
          void submitScan(raw);
        }}
      >
        <label className="kiosk-scan-label" htmlFor="kiosk-scan-input">
          Scan card or type ID
        </label>
        <input
          id="kiosk-scan-input"
          ref={inputRef}
          className="kiosk-scan-input"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          spellCheck={false}
          inputMode="text"
          enterKeyHint="done"
          placeholder="•••••••"
          aria-describedby="kiosk-scan-help"
        />
        <div className="kiosk-scan-row">
          <label className="kiosk-kind">
            <span>Session type</span>
            <select value={kind} onChange={(event) => setKind(event.target.value)}>
              <option value="build">Build</option>
              <option value="meeting">Meeting</option>
              <option value="outreach">Outreach</option>
              <option value="competition">Competition</option>
              <option value="other">Other</option>
            </select>
          </label>
          {/* Not disabled while busy: a back-to-back scan must still submit. */}
          <button type="submit" className="kiosk-submit" disabled={!code.trim()}>
            {busy ? "Working…" : "Clock in / out"}
          </button>
        </div>
        <p id="kiosk-scan-help" className="app-muted kiosk-help">
          The field stays focused, so the next student can scan straight away. One scan clocks in; the next
          scan from the same card clocks out.
        </p>
      </form>

      <div className={banner ? `kiosk-banner ${banner.tone}` : "kiosk-banner idle"} role="status" aria-live="assertive">
        {banner ? banner.message : "Ready — scan a card."}
      </div>

      {rejected.length ? (
        <div className="app-card kiosk-rejected" role="alert">
          <strong>{rejected.length} queued scan{rejected.length === 1 ? "" : "s"} could not sync</strong>
          <ul>
            {rejected.map((row) => (
              <li key={row.clientId}>
                {row.displayName ?? "Unknown card"} — {row.reason}
              </li>
            ))}
          </ul>
          <p className="app-muted">
            These are still stored on this device. Fix the card enrollment, then use Sync now — nothing has
            been discarded and no hours have been guessed.
          </p>
        </div>
      ) : null}

      <div className="kiosk-columns">
        <section className="app-card kiosk-panel">
          <header>
            <h2>In the shop now</h2>
            <span className="app-badge good">{openSessions.length}</span>
          </header>
          {openSessions.length ? (
            <ul className="kiosk-here">
              {openSessions.map((session) => (
                <li key={session.id}>
                  <strong>{session.userName ?? "Member"}</strong>
                  <b>{elapsedLabel(session.clockIn, now)}</b>
                </li>
              ))}
            </ul>
          ) : (
            <p className="app-muted">Nobody is clocked in right now.</p>
          )}
          {canAdmin ? (
            <>
              <button type="button" className="app-button secondary" onClick={() => void runSweep()} disabled={busy}>
                Run forgot-to-sign-out sweep
              </button>
              <p className="app-muted kiosk-help">
                Closes sessions open longer than {policy.afterHours}h, credits at most {policy.creditHours}h,
                and flags each row for you to correct. It never credits the full overnight time.
              </p>
              {sweep ? <p className="kiosk-sweep-result">{sweep}</p> : null}
            </>
          ) : null}
        </section>

        <section className="app-card kiosk-panel">
          <header>
            <h2>Travel eligibility</h2>
            {policy.travelEligibilityHours == null ? (
              <span className="app-badge setup">Not set</span>
            ) : (
              <span className="app-badge">{policy.travelEligibilityHours}h</span>
            )}
          </header>
          <p className="app-muted">{summary.headline}</p>
          {summary.flaggedSessions > 0 ? (
            <p className="kiosk-flag-note">
              {summary.flaggedSessions} auto-closed session{summary.flaggedSessions === 1 ? "" : "s"} are
              included at a capped credit and still need a mentor to set the real clock-out.
            </p>
          ) : null}
          <ul className="kiosk-board">
            {board.slice(0, 12).map((row) => (
              <li key={row.userId} className={row.status === "met" ? "met" : undefined}>
                <div className="who">
                  <strong>{row.name ?? "Member"}</strong>
                  {row.openSince ? <em>IN</em> : null}
                </div>
                <span className="value">{row.label}</span>
                {row.percent != null ? (
                  <div className="track" aria-hidden="true">
                    <i className={row.status === "met" ? "done" : undefined} style={{ width: `${row.percent}%` }} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          {board.length === 0 ? <p className="app-muted">No members on this team yet.</p> : null}
          {board.length > 12 ? (
            <p className="app-muted kiosk-help">Showing 12 of {board.length} members.</p>
          ) : null}
          <p className="app-muted kiosk-help">
            A session still open past {policy.afterHours}h counts as {policy.creditHours}h here — the same
            capped credit the sweep would give it — so a forgotten sign-out never inflates these totals.
          </p>
        </section>
      </div>

      {canAdmin ? (
        <section className="app-card kiosk-panel kiosk-admin">
          <header>
            <h2>Kiosk setup</h2>
            <div className="kiosk-tabs">
              <button
                type="button"
                className={panel === "cards" ? "active" : undefined}
                onClick={() => setPanel(panel === "cards" ? "none" : "cards")}
              >
                Cards ({scanCodes.length})
              </button>
              <button
                type="button"
                className={panel === "policy" ? "active" : undefined}
                onClick={() => setPanel(panel === "policy" ? "none" : "policy")}
              >
                Sweep &amp; threshold
              </button>
            </div>
          </header>

          {unenrolledCount > 0 ? (
            <p className="app-muted">
              {unenrolledCount} member{unenrolledCount === 1 ? " has" : "s have"} no card enrolled — they can
              still use the tap-your-name view on the full hours page.
            </p>
          ) : null}

          {panel === "cards" ? (
            <CardsPanel
              orgId={orgId}
              members={totals.map((total) => ({ userId: total.userId, name: total.name }))}
              codes={scanCodes}
              post={post}
              onChanged={async () => {
                await load();
                refocus();
              }}
            />
          ) : null}

          {panel === "policy" ? (
            <PolicyPanel
              orgId={orgId}
              afterHours={policy.afterHours}
              creditHours={policy.creditHours}
              travelEligibilityHours={policy.travelEligibilityHours}
              post={post}
              onChanged={async () => {
                await load();
                refocus();
              }}
            />
          ) : null}
        </section>
      ) : (
        <p className="app-muted kiosk-help">
          This device is signed in without owner/admin access — only your own card will scan here. Ask a
          mentor to sign the kiosk in.
        </p>
      )}

      <p className="app-muted kiosk-help">
        Cards are stored as codes, never as emails, and only the last four characters are ever shown on this
        screen. {nameById.size} member{nameById.size === 1 ? "" : "s"} on this team.
      </p>
    </main>
  );
}

type PostFn = (body: Record<string, unknown>) => Promise<Record<string, unknown>>;

function CardsPanel(props: {
  orgId: string;
  members: Array<{ userId: string; name: string | null }>;
  codes: KioskScanCodeRow[];
  post: PostFn;
  onChanged: () => Promise<void>;
}) {
  const [userId, setUserId] = useState("");
  const [code, setCode] = useState("");
  const [codeKind, setCodeKind] = useState("student_id");
  const [label, setLabel] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const enroll = async () => {
    setBusy(true);
    setMessage("");
    try {
      await props.post({ action: "enroll_code", orgId: props.orgId, userId, code, codeKind, label });
      setCode("");
      setLabel("");
      setMessage("Card enrolled.");
      await props.onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not enroll that card.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setMessage("");
    try {
      await props.post({ action: "remove_code", orgId: props.orgId, id });
      await props.onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not remove that card.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="kiosk-form">
      <p className="app-muted">
        Scan a card into the code box to enroll it. Use whatever the reader types — a student-ID barcode, an
        RFID fob, or a number you assign. Never an email address.
      </p>
      <div className="kiosk-form-grid">
        <label className="hours-field">
          <span>Member</span>
          <select value={userId} onChange={(event) => setUserId(event.target.value)}>
            <option value="">Choose a member…</option>
            {props.members.map((member) => (
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
            onChange={(event) => setCode(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="Scan the card here"
          />
        </label>
        <label className="hours-field">
          <span>Kind</span>
          <select value={codeKind} onChange={(event) => setCodeKind(event.target.value)}>
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
            onChange={(event) => setLabel(event.target.value)}
            placeholder="blue lanyard card"
            maxLength={80}
          />
        </label>
      </div>
      <button
        type="button"
        className="app-button"
        onClick={() => void enroll()}
        disabled={busy || !userId || !code.trim()}
      >
        Enroll card
      </button>
      {message ? <p className="kiosk-sweep-result">{message}</p> : null}

      {props.codes.length ? (
        <ul className="kiosk-cards">
          {props.codes.map((row) => (
            <li key={row.id}>
              <div>
                <strong>{row.userName ?? "Member"}</strong>
                <small>
                  {SCAN_CODE_KIND_LABELS[row.codeKind]} · {row.maskedCode}
                  {row.label ? ` · ${row.label}` : ""}
                </small>
              </div>
              <button type="button" className="hours-link danger" onClick={() => void remove(row.id)} disabled={busy}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="app-muted">No cards enrolled yet.</p>
      )}
    </div>
  );
}

function PolicyPanel(props: {
  orgId: string;
  afterHours: number;
  creditHours: number;
  travelEligibilityHours: number | null;
  post: PostFn;
  onChanged: () => Promise<void>;
}) {
  const [afterHours, setAfterHours] = useState(String(props.afterHours || DEFAULT_AUTO_CLOSE_AFTER_HOURS));
  const [creditHours, setCreditHours] = useState(String(props.creditHours || DEFAULT_AUTO_CLOSE_CREDIT_HOURS));
  const [threshold, setThreshold] = useState(
    props.travelEligibilityHours == null ? "" : String(props.travelEligibilityHours),
  );
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setMessage("");
    try {
      await props.post({
        action: "set_kiosk_policy",
        orgId: props.orgId,
        autoCloseAfterHours: Number(afterHours),
        autoCloseCreditHours: Number(creditHours),
        travelEligibilityHours: threshold.trim() === "" ? null : Number(threshold),
      });
      setMessage("Saved.");
      await props.onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="kiosk-form">
      <div className="kiosk-form-grid">
        <label className="hours-field">
          <span>Sweep after (hours open)</span>
          <input
            type="number"
            min={1}
            max={168}
            step={0.5}
            value={afterHours}
            onChange={(event) => setAfterHours(event.target.value)}
          />
        </label>
        <label className="hours-field">
          <span>Max credited hours</span>
          <input
            type="number"
            min={0}
            max={24}
            step={0.5}
            value={creditHours}
            onChange={(event) => setCreditHours(event.target.value)}
          />
        </label>
        <label className="hours-field">
          <span>Travel-hours threshold</span>
          <input
            type="number"
            min={0}
            step={1}
            value={threshold}
            onChange={(event) => setThreshold(event.target.value)}
            placeholder="leave blank — none"
          />
        </label>
      </div>
      <p className="app-muted">
        Leave the threshold blank if your team does not gate travel on hours. Blank means the kiosk says
        &ldquo;no threshold set&rdquo; instead of inventing one.
      </p>
      <button type="button" className="app-button" onClick={() => void save()} disabled={busy}>
        Save kiosk policy
      </button>
      {message ? <p className="kiosk-sweep-result">{message}</p> : null}
    </div>
  );
}
