"use client";

import { needsShortCodeHandoff, type ScoutQrRecord } from "@vantage/scouting/qr-handoff";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { EmptyState, Panel, Button } from "../../components/ui";
import {
  encodePendingQrPayload,
  listPendingEntries,
  mergeQrHandoffIntoOutbox,
  publishPendingShortCodeHandoff,
  syncOutbox,
} from "../../lib/scout-offline";
import {
  cameraScanSupported,
  openRearCamera,
  renderQrDataUrl,
  scanQrFromCamera,
} from "../../lib/scouting/qr-camera";
import {
  QR_HANDOFF_RELATED_INCLUDE,
  classifyQrHandoffShell,
  formatQrHandoffMetric,
  qrHandoffNextActions,
  qrHandoffQueueCopy,
  qrHandoffRelatedLinks,
  qrHandoffSetupSteps,
  qrHandoffShellCopy,
  type QrHandoffNextAction,
  type QrHandoffShellKind,
} from "../../lib/scouting/qr-handoff-related";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";

type Props = {
  orgId: string;
  eventKey: string | null;
  schemaId: string | null;
  entryType: "match" | "pit";
  onSynced?: () => void;
  onMessage?: (message: string) => void;
};

function QrHandoffRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = qrHandoffRelatedLinks(orgId, {
    include: [...QR_HANDOFF_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related scout-qr-related" aria-label="Related scouting tools">
      {links.map((link) => (
        <a key={link.href} href={link.href}>{link.label}</a>
      ))}
    </nav>
  );
}

function QrHandoffNextActionsPanel({ actions }: { actions: QrHandoffNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions scout-qr-next-actions" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <a className="edc-next-action" href={action.href}>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function QrHandoffShell({
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  orgId?: string | null;
  shell: QrHandoffShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = qrHandoffNextActions({ orgId, shell });
  const copy = qrHandoffShellCopy(shell);
  const setup = shell === "setup" ? qrHandoffSetupSteps(orgId)[0] : null;
  const scoutingHref = hubHref("/competition", "scouting", orgId);

  return (
    <div className="scout-workbench scout-qr-workbench soft-gate">
      <header className="scout-qr-heading">
        <div>
          <h2 style={{ marginTop: 0 }}>Hand off scouting by QR</h2>
          <p className="app-muted">
            No signal? Show this code to a teammate whose phone has signal. Their phone sends your matches
            to the team.
          </p>
        </div>
        <QrHandoffRelatedStrip orgId={orgId} />
      </header>
      {children}
      <EmptyState
        soft
        className="scout-qr-empty"
        badge={
          shell === "setup"
            ? "Needs setup"
            : shell === "error"
              ? "Unavailable"
              : shell === "empty"
                ? "Queue clear"
                : copy.badge
        }
        badgeTone="setup"
        title={copy.title}
        description={error ?? copy.description}
        aria-busy={shell === "loading"}
      >
        {shell === "error" && onRetry ? (
          <Button variant="secondary" type="button" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        {setup ? (
          <Button as="a" variant="primary" href={setup.href}>
            {setup.label}
          </Button>
        ) : null}
        {shell === "empty" ? (
          <Button as="a" variant="primary" href={scoutingHref}>
            Save a scout entry
          </Button>
        ) : null}
      </EmptyState>
      {shell === "ready" ? <QrHandoffNextActionsPanel actions={actions} /> : null}
    </div>
  );
}

export default function ScoutHandoffPanel({
  orgId,
  eventKey,
  schemaId,
  entryType,
  onSynced,
  onMessage,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [paste, setPaste] = useState("");
  const [qrImage, setQrImage] = useState("");
  const [qrText, setQrText] = useState("");
  const [shortCode, setShortCode] = useState("");
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSyncedCount, setLastSyncedCount] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);

  async function refreshPending() {
    const pending = await listPendingEntries();
    setPendingCount(eventKey ? pending.filter((row) => row.eventKey === eventKey).length : pending.length);
    setLoaded(true);
  }

  // Follow the queue like the header does: back online it uploads, and "1 pending" sat under
  // "Uploaded 1 entry" until the page was reloaded.
  useEffect(() => {
    const again = () => {
      if (document.visibilityState !== "hidden") void refreshPending();
    };
    window.addEventListener("online", again);
    document.addEventListener("visibilitychange", again);
    const tick = window.setInterval(again, 5_000);
    return () => {
      window.removeEventListener("online", again);
      document.removeEventListener("visibilitychange", again);
      window.clearInterval(tick);
    };
  }, [eventKey]);

  useEffect(() => {
    void refreshPending();
    return () => {
      abortRef.current?.abort();
      const stream = videoRef.current?.srcObject as MediaStream | null;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [eventKey]);

  // Said in the card as well as passed up: the page showed it far from the button, so a tap
  // that failed looked like a tap that did nothing.
  const [note, setNote] = useState<string | null>(null);
  function tell(message: string) {
    setNote(message);
    onMessage?.(message);
  }

  async function afterMerge(result: { accepted: number; replaced: number; ignored: number; mode: string }) {
    await refreshPending();
    tell(
      `Merged QR (${result.mode}): +${result.accepted} new, ${result.replaced} updated, ${result.ignored} kept local.`,
    );
    if (navigator.onLine) {
      try {
        const synced = await syncOutbox(orgId);
        if (synced.count) {
          setLastSyncedCount(synced.count);
          await refreshPending();
          tell(
            `Sent ${synced.count} ${synced.count === 1 ? "entry" : "entries"} to the team. Nothing is waiting on this phone.`,
          );
        } else {
          tell("Got it. Those matches are saved on this phone and send as soon as it has signal.");
        }
        onSynced?.();
      } catch (error) {
        tell(
          error instanceof Error
            ? `${error.message} The matches are still saved on this phone; try again when you have signal.`
            : "Not sent yet. The matches are still saved on this phone.",
        );
      }
    }
  }

  async function ingestContent(content: string) {
    if (!schemaId) {
      tell("Publish a scouting form before importing QR handoffs.");
      return;
    }
    setBusy(true);
    try {
      const result = await mergeQrHandoffIntoOutbox({
        content,
        schemaId,
        type: entryType,
        orgId,
      });
      await afterMerge(result);
      setPaste("");
    } catch (error) {
      tell(error instanceof Error ? error.message : "QR import failed");
    } finally {
      setBusy(false);
    }
  }

  async function buildShareQr(forceShortCode: boolean) {
    setBusy(true);
    setQrImage("");
    setShortCode("");
    try {
      const pending = await listPendingEntries();
      const scoped = (eventKey ? pending.filter((row) => row.eventKey === eventKey) : pending).map(
        (entry): ScoutQrRecord => ({
          clientId: entry.clientId,
          eventKey: entry.eventKey,
          matchKey: entry.matchKey,
          teamKey: entry.teamKey,
          type: entry.type,
          schemaId: entry.schemaId,
          payload: entry.payload,
          confidence: entry.confidence,
          source: entry.source,
          updatedAt: entry.updatedAt,
        }),
      );
      if (!scoped.length) {
        tell("Nothing to hand off: every match on this phone has been sent.");
        return;
      }
      if (forceShortCode || needsShortCodeHandoff(scoped)) {
        if (!navigator.onLine) {
          tell("Batch is too large for an embedded QR. Reconnect to mint a short handoff code.");
          return;
        }
        const published = await publishPendingShortCodeHandoff(orgId, { eventKey: eventKey ?? undefined });
        setShortCode(published.userCode);
        setQrText(published.qrPayload);
        setQrImage(await renderQrDataUrl(published.qrPayload));
        tell(`Short-code handoff ${published.userCode} · ${published.recordCount} entries · expires in 15 min`);
      } else {
        const payload = await encodePendingQrPayload({ eventKey: eventKey ?? undefined });
        setQrText(payload);
        setQrImage(await renderQrDataUrl(payload));
        tell(`Embedded QR ready for ${scoped.length} pending entr${scoped.length === 1 ? "y" : "ies"}`);
      }
    } catch (error) {
      tell(error instanceof Error ? error.message : "Could not build handoff QR");
    } finally {
      setBusy(false);
    }
  }

  async function startScan() {
    if (!cameraScanSupported() || !videoRef.current || !canvasRef.current) {
      tell("Camera scan unavailable — paste a vantage:// payload or short code instead.");
      return;
    }
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    setScanning(true);
    try {
      const stream = await openRearCamera();
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      const value = await scanQrFromCamera({
        video: videoRef.current,
        canvas: canvasRef.current,
        signal: abort.signal,
      });
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
      setScanning(false);
      await ingestContent(value);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      tell(error instanceof Error ? error.message : "Camera scan failed");
      setScanning(false);
    }
  }

  function stopScan() {
    abortRef.current?.abort();
    const stream = videoRef.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((track) => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setScanning(false);
  }

  const shell = classifyQrHandoffShell({
    loading: !loaded,
    orgId,
    schemaId,
    pendingCount,
    lastSyncedCount,
  });
  const queueCopy = qrHandoffQueueCopy({
    loaded,
    pendingCount,
    lastSyncedCount,
  });
  const scoutingHref = hubHref("/competition", "scouting", orgId);
  const offlineHref = withOrgHref("/offline", orgId);
  const readyActions = qrHandoffNextActions({
    orgId,
    shell: "ready",
    pendingCount,
    lastSyncedCount,
  });

  if (shell === "loading" || shell === "setup" || shell === "empty") {
    return (
      <QrHandoffShell orgId={orgId} shell={shell} onRetry={() => void refreshPending()}>
        {shell === "empty" ? (
          <p className="form-message scout-qr-message" role="status">
            <strong>{queueCopy.badge}</strong> — {queueCopy.description}
          </p>
        ) : null}
      </QrHandoffShell>
    );
  }

  return (
    <div className="scout-workbench scout-qr-workbench">
      <Panel as="section" className="scout-qr-panel" id="scout-qr-share">
        <header className="scout-qr-heading">
          <div>
            <h2 style={{ marginTop: 0 }}>Hand off scouting by QR</h2>
            <p className="app-muted">
              No signal? Show this code to a teammate whose phone has signal. Their phone sends your matches to
              the team. To take a teammate's matches, scan their code or paste it below.
            </p>
          </div>
          <div className="scout-qr-heading-meta">
            <span className="app-badge">{queueCopy.badge}</span>
            <QrHandoffRelatedStrip orgId={orgId} />
          </div>
        </header>

        <p className="form-message scout-qr-message" role="status">
          <strong>{queueCopy.title}</strong> — {queueCopy.description}
        </p>

        <div className="scout-qr-actions">
          <Button variant="primary" type="button" disabled={busy || !pendingCount} onClick={() => void buildShareQr(false)}>
            Show handoff QR
          </Button>
          <Button variant="secondary" type="button" disabled={busy || !pendingCount || !navigator.onLine} onClick={() => void buildShareQr(true)}>
            Short code (large batch)
          </Button>
        </div>
        {typeof navigator !== "undefined" && !navigator.onLine ? (
          <p className="app-muted scout-qr-note">A short code needs signal; the QR works without it.</p>
        ) : null}
        {note ? (
          <p className="scout-qr-note" role="status">
            {note}
          </p>
        ) : null}

        {shortCode ? (
          <p className="form-message" role="status">
            Code <strong className="scout-qr-code">{shortCode}</strong> — peer can scan the QR or type the code.
          </p>
        ) : null}

        {qrImage ? (
          <figure className="scout-qr-figure">
            { }
            <img src={qrImage} alt="Scout handoff QR code" width={280} height={280} />
            <figcaption>
              <p className="app-muted">Your teammate opens QR handoff on their phone and taps Scan.</p>
              <details>
                <summary>Can&apos;t scan? Copy the code as text</summary>
                <textarea readOnly value={qrText} rows={3} aria-label="Handoff code as text" />
              </details>
            </figcaption>
          </figure>
        ) : null}

        {queueCopy.tone === "synced" ? (
          <EmptyState
            soft
            className="scout-qr-empty"
            badge="Synced"
            badgeTone="setup"
            title={queueCopy.title}
            description={queueCopy.description}
          >
            <Button as="a" variant="primary" href={scoutingHref}>
              Open Scouting
            </Button>
            <Button as="a" variant="secondary" href={offlineHref}>
              Open Offline
            </Button>
          </EmptyState>
        ) : null}
      </Panel>

      <Panel as="section" className="scout-qr-panel">
        <h2 style={{ marginTop: 0 }}>Receive on this device</h2>
        <p className="app-muted">
          Camera scan, paste a <code>vantage://</code> payload, or enter an 8-character short code.
        </p>

        <div className="scout-qr-actions">
          {scanning ? (
            <Button variant="secondary" type="button" onClick={stopScan}>
              Stop camera
            </Button>
          ) : (
            <Button variant="primary" type="button" disabled={busy} onClick={() => void startScan()}>
              Scan with camera
            </Button>
          )}
        </div>

        <div className={["scout-qr-viewport", scanning ? "is-live" : ""].filter(Boolean).join(" ")}>
          <video
            ref={videoRef}
            className="scout-qr-video"
            muted
            playsInline
            style={{ display: scanning ? "block" : "none" }}
          />
          {!scanning ? (
            <p className="app-muted">
              {formatQrHandoffMetric(pendingCount, loaded)} pending on this device — scan to merge a peer QR.
            </p>
          ) : null}
        </div>
        <canvas ref={canvasRef} className="scout-qr-canvas" hidden />

        <label className="scout-qr-manual">
          Paste QR text or short code
          <textarea
            value={paste}
            onChange={(event) => setPaste(event.target.value)}
            placeholder="vantage://scout/… or AB3D-EF7H"
            rows={3}
          />
        </label>
        <Button variant="secondary" type="button" disabled={busy || !paste.trim()} onClick={() => void ingestContent(paste)}>
          Take these matches
        </Button>
      </Panel>

      <QrHandoffNextActionsPanel actions={readyActions} />
    </div>
  );
}
