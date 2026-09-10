"use client";

import { needsShortCodeHandoff, type ScoutQrRecord } from "@vantage/scouting/qr-handoff";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { EmptyState, FormRow, Panel, Button } from "../../components/ui";
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
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
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
        <p className="app-muted">Each one opens the page where you finish the work.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <Button as="a" variant="secondary" href={action.href}>
              Open
            </Button>
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
  const offlineHref = withOrgHref("/offline", orgId);

  return (
    <div className="scout-workbench scout-qr-workbench soft-gate">
      <header className="scout-qr-heading">
        <div>
          <h2 style={{ marginTop: 0 }}>QR scout handoff</h2>
          <p className="app-muted">
            Transfer pending IndexedDB outbox rows between devices. Scans merge offline (last write wins),
            then sync when venue Wi-Fi returns.
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
            ? "Setup required"
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
          <>
            <Button as="a" variant="primary" href={scoutingHref}>
              Save a scout entry
            </Button>
            <Button as="a" variant="secondary" href={offlineHref}>
              Open Offline
            </Button>
          </>
        ) : null}
      </EmptyState>
      <QrHandoffNextActionsPanel actions={actions} />
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

  useEffect(() => {
    void refreshPending();
    return () => {
      abortRef.current?.abort();
      const stream = videoRef.current?.srcObject as MediaStream | null;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [eventKey]);

  function tell(message: string) {
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
            `Synced ${synced.count} handoff entries — queue clear after sync. Open Scouting or Offline if you need the cold-boot shell.`,
          );
        } else {
          tell("Handoff merged into the outbox — sync when the venue link stabilizes, or keep using QR.");
        }
        onSynced?.();
      } catch (error) {
        tell(
          error instanceof Error
            ? `${error.message} Entries stay queued — retry Sync or QR handoff.`
            : "Sync paused — entries stay in the outbox.",
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
        tell("Queue clear — save scout entries offline first before sharing a QR.");
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
  const coverageHref = withOrgHref("/scouting/lineup", orgId);
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
            <h2 style={{ marginTop: 0 }}>QR scout handoff</h2>
            <p className="app-muted">
              Transfer pending IndexedDB outbox rows between devices. Scans merge offline (last write wins),
              then sync into disagreements and the coverage board.
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
          <Button as="a" variant="secondary" href={scoutingHref}>
            Scouting
          </Button>
          <Button as="a" variant="secondary" href={offlineHref}>
            Offline
          </Button>
          <Button as="a" variant="secondary" href={coverageHref}>
            Coverage
          </Button>
        </div>

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
              <FormRow label="Payload / URI">
                <textarea readOnly value={qrText} rows={3} />
              </FormRow>
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
          Merge into outbox
        </Button>
      </Panel>

      <QrHandoffNextActionsPanel actions={readyActions} />
    </div>
  );
}
