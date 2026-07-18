"use client";

import { needsShortCodeHandoff, type ScoutQrRecord } from "@vantage/scouting/qr-handoff";
import { useEffect, useRef, useState } from "react";
import { FormRow, Panel } from "../../components/ui";
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

type Props = {
  orgId: string;
  eventKey: string | null;
  schemaId: string | null;
  entryType: "match" | "pit";
  onSynced?: () => void;
  onMessage?: (message: string) => void;
};

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
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);

  async function refreshPending() {
    const pending = await listPendingEntries();
    setPendingCount(eventKey ? pending.filter((row) => row.eventKey === eventKey).length : pending.length);
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
      const synced = await syncOutbox(orgId);
      if (synced) {
        tell(`Synced ${synced} handoff entries — open Conflicts + Lineup for disagreements/coverage.`);
        onSynced?.();
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
        tell("Save scout entries offline first — nothing in the outbox to hand off.");
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

  return (
    <div className="scout-workbench">
      <Panel as="section">
        <header className="scout-form-heading">
          <div>
            <h2 style={{ marginTop: 0 }}>QR scout handoff</h2>
            <p className="app-muted">
              Transfer pending IndexedDB outbox rows between devices. Scans merge offline (last write wins),
              then sync into disagreements and the coverage board.
            </p>
          </div>
          <span className="app-badge">{pendingCount} pending</span>
        </header>

        <div className="scout-conflict-actions" style={{ marginBottom: 12 }}>
          <button
            type="button"
            className="app-button"
            disabled={busy || !pendingCount}
            onClick={() => void buildShareQr(false)}
          >
            Show handoff QR
          </button>
          <button
            type="button"
            className="app-button secondary"
            disabled={busy || !pendingCount || !navigator.onLine}
            onClick={() => void buildShareQr(true)}
          >
            Short code (large batch)
          </button>
          <a className="app-button secondary" href={`/scouting/lineup?orgId=${encodeURIComponent(orgId)}`}>
            Coverage dashboard
          </a>
        </div>

        {shortCode ? (
          <p className="form-message" role="status">
            Code <strong>{shortCode}</strong> — peer can scan the QR or type the code.
          </p>
        ) : null}

        {qrImage ? (
          <div className="scout-qr-card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrImage} alt="Scout handoff QR code" width={280} height={280} />
            <FormRow label="Payload / URI">
              <textarea readOnly value={qrText} rows={3} />
            </FormRow>
          </div>
        ) : null}
      </Panel>

      <Panel as="section">
        <h2 style={{ marginTop: 0 }}>Receive on this device</h2>
        <p className="app-muted">
          Camera scan, paste a <code>vantage://</code> payload, or enter an 8-character short code.
        </p>

        <div className="scout-conflict-actions" style={{ marginBottom: 12 }}>
          {scanning ? (
            <button type="button" className="app-button secondary" onClick={stopScan}>
              Stop camera
            </button>
          ) : (
            <button type="button" className="app-button" disabled={busy} onClick={() => void startScan()}>
              Scan with camera
            </button>
          )}
        </div>

        <video
          ref={videoRef}
          className="scout-qr-video"
          muted
          playsInline
          style={{ display: scanning ? "block" : "none", width: "100%", maxWidth: 420, borderRadius: 8 }}
        />
        <canvas ref={canvasRef} hidden />

        <FormRow label="Paste QR text or short code">
          <textarea
            value={paste}
            onChange={(event) => setPaste(event.target.value)}
            placeholder="vantage://scout/… or AB3D-EF7H"
            rows={3}
          />
        </FormRow>
        <button
          type="button"
          className="app-button secondary"
          disabled={busy || !paste.trim()}
          onClick={() => void ingestContent(paste)}
        >
          Merge into outbox
        </button>
      </Panel>
    </div>
  );
}
