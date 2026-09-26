"use client";

import { needsShortCodeHandoff, type ScoutQrRecord } from "@vantage/scouting/qr-handoff";
import { useEffect, useRef, useState } from "react";
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
import { classifyQrHandoffShell, qrHandoffShellCopy } from "../../lib/scouting/qr-handoff-related";

type Props = {
  orgId: string;
  eventKey: string | null;
  schemaId: string | null;
  entryType: "match" | "pit";
  onSynced?: () => void;
  onMessage?: (message: string) => void;
};

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * QR handoff: one phone has no signal, a teammate's phone does.
 *
 * The phone with the matches shows a code; the phone with signal scans it and sends them. Both
 * halves are always on screen. The receiving half used to hide whenever this phone had nothing
 * queued — which is exactly the phone with signal that is meant to scan — so there was no Scan
 * button on the one phone that needed it.
 */
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
  const [online, setOnline] = useState(true);

  async function refreshPending() {
    try {
      const pending = await listPendingEntries();
      setPendingCount(eventKey ? pending.filter((row) => row.eventKey === eventKey).length : pending.length);
    } catch {
      setPendingCount(0);
    }
    setLoaded(true);
  }

  // Follow the queue like the header does: back online it uploads, and "1 pending" sat under
  // "Uploaded 1 entry" until the page was reloaded.
  useEffect(() => {
    setOnline(navigator.onLine);
    const again = () => {
      setOnline(navigator.onLine);
      if (document.visibilityState !== "hidden") void refreshPending();
    };
    window.addEventListener("online", again);
    window.addEventListener("offline", again);
    document.addEventListener("visibilitychange", again);
    const tick = window.setInterval(again, 5_000);
    return () => {
      window.removeEventListener("online", again);
      window.removeEventListener("offline", again);
      document.removeEventListener("visibilitychange", again);
      window.clearInterval(tick);
    };
  }, [eventKey]);

  useEffect(() => {
    void refreshPending();
    const video = videoRef.current;
    return () => {
      abortRef.current?.abort();
      const stream = video?.srcObject as MediaStream | null;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [eventKey]);

  // Said in the card as well as passed up: the page showed it far from the button, so a tap
  // that failed looked like a tap that did nothing.
  const [sendNote, setSendNote] = useState<string | null>(null);
  const [receiveNote, setReceiveNote] = useState<string | null>(null);
  function tellSend(message: string) {
    setSendNote(message);
    onMessage?.(message);
  }
  function tellReceive(message: string) {
    setReceiveNote(message);
    onMessage?.(message);
  }

  async function afterMerge(result: { accepted: number; replaced: number; ignored: number }) {
    await refreshPending();
    const taken = result.accepted + result.replaced;
    const got = taken
      ? `Got ${plural(taken, "match", "matches")} from your teammate.`
      : "This phone already had those matches.";
    tellReceive(got);
    if (!navigator.onLine) {
      tellReceive(`${got} They are saved on this phone and send as soon as it has signal.`);
      return;
    }
    try {
      const synced = await syncOutbox(orgId);
      if (synced.count) {
        setLastSyncedCount(synced.count);
        await refreshPending();
        tellReceive(`${got} Sent ${plural(synced.count, "entry", "entries")} to the team.`);
      } else if (taken) {
        tellReceive(`${got} They are saved on this phone and send as soon as it has signal.`);
      }
      onSynced?.();
    } catch {
      tellReceive(`${got} Not sent yet: they are saved on this phone. Try Sync now when the signal is better.`);
    }
  }

  async function ingestContent(content: string) {
    if (!schemaId) {
      tellReceive("Your team needs a published scouting form before this phone can take matches.");
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
      const text = error instanceof Error ? error.message : "";
      // The decoder's own words ("Unrecognized scout QR payload") mean nothing to a scout.
      tellReceive(
        /unrecognized|empty qr|lacks event|must be an object|json/i.test(text) || !text
          ? "That isn't a scouting code. Scan the code on your teammate's QR handoff screen, or type its 8 letters."
          : text,
      );
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
        tellSend("Nothing to hand off: every match on this phone has been sent.");
        return;
      }
      if (forceShortCode || needsShortCodeHandoff(scoped)) {
        if (!navigator.onLine) {
          tellSend(
            "Too many matches for one QR code, and a short code needs signal. Sync when you have signal, or hand off after each match so the code stays small.",
          );
          return;
        }
        const published = await publishPendingShortCodeHandoff(orgId, { eventKey: eventKey ?? undefined });
        setShortCode(published.userCode);
        setQrText(published.qrPayload);
        setQrImage(await renderQrDataUrl(published.qrPayload));
        tellSend(
          `Code ${published.userCode} holds ${plural(published.recordCount, "match", "matches")}. It works for 15 minutes.`,
        );
      } else {
        const payload = await encodePendingQrPayload({ eventKey: eventKey ?? undefined });
        setQrText(payload);
        setQrImage(await renderQrDataUrl(payload));
        tellSend(`This code holds ${plural(scoped.length, "match", "matches")}. Your teammate scans it.`);
      }
    } catch {
      tellSend("Could not make the code. Try again, or sync when you have signal.");
    } finally {
      setBusy(false);
    }
  }

  async function startScan() {
    if (!cameraScanSupported() || !videoRef.current || !canvasRef.current) {
      tellReceive("This phone can't scan here. Type the 8-letter code, or paste the code's text, below.");
      return;
    }
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    setScanning(true);
    setReceiveNote(null);
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
      tellReceive(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "The camera is blocked for this site. Allow it in the browser, or type the 8-letter code below."
          : "The camera didn't start. Type the 8-letter code below instead.",
      );
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

  const shell = classifyQrHandoffShell({ loading: !loaded, orgId, schemaId, pendingCount, lastSyncedCount });

  if (shell === "setup") {
    const copy = qrHandoffShellCopy("setup");
    return (
      <div className="scout-workbench scout-qr-workbench">
        <EmptyState soft className="scout-qr-empty" badge="Needs setup" badgeTone="setup" title={copy.title} description={copy.description} />
      </div>
    );
  }

  const hasQueue = loaded && pendingCount > 0;

  return (
    <div className="scout-workbench scout-qr-workbench">
      <Panel as="section" className="scout-qr-panel" id="scout-qr-share" aria-labelledby="scout-qr-send-title">
        <h2 id="scout-qr-send-title" className="scout-qr-title">
          Send from this phone
        </h2>
        {!loaded ? (
          <p className="app-muted" role="status">
            Checking what is saved on this phone…
          </p>
        ) : hasQueue ? (
          <>
            <p className="scout-qr-lede" role="status">
              <strong>{plural(pendingCount, "match", "matches")} saved here, not sent yet.</strong> No signal? Show this
              code to a teammate whose phone has signal. Their phone sends {pendingCount === 1 ? "it" : "them"} to the
              team.
            </p>
            <div className="scout-qr-actions">
              <Button variant="primary" type="button" disabled={busy} onClick={() => void buildShareQr(false)}>
                Show handoff QR
              </Button>
            </div>
          </>
        ) : (
          <p className="scout-qr-lede" role="status">
            {lastSyncedCount > 0
              ? "Everything is sent. Nothing is waiting on this phone."
              : "Nothing waiting on this phone. Matches you save with no signal show up here to hand off."}
          </p>
        )}
        {sendNote ? (
          <p className="scout-qr-note" role="status">
            {sendNote}
          </p>
        ) : null}

        {shortCode ? (
          <p className="scout-qr-short">
            Or type <strong className="scout-qr-code">{shortCode}</strong> on your teammate&apos;s phone.
          </p>
        ) : null}

        {qrImage ? (
          <figure className="scout-qr-figure">
            <img src={qrImage} alt="Scouting handoff QR code" width={280} height={280} />
            <figcaption>
              <p className="app-muted">Your teammate opens QR handoff and taps Scan a teammate&apos;s code.</p>
              <details>
                <summary>Can&apos;t scan? Copy the code as text</summary>
                <textarea readOnly value={qrText} rows={3} aria-label="Handoff code as text" />
              </details>
            </figcaption>
          </figure>
        ) : null}

        {hasQueue ? (
          <details className="scout-qr-more">
            <summary>Too many matches to fit in one code?</summary>
            <p className="app-muted">
              A short code holds any number of matches, but making one needs signal on this phone.
            </p>
            <Button variant="secondary" type="button" disabled={busy || !online} onClick={() => void buildShareQr(true)}>
              Get a short code
            </Button>
            {!online ? <p className="app-muted scout-qr-note">No signal right now: use the QR code.</p> : null}
          </details>
        ) : null}
      </Panel>

      <Panel as="section" className="scout-qr-panel" aria-labelledby="scout-qr-receive-title">
        <h2 id="scout-qr-receive-title" className="scout-qr-title">
          Take a teammate&apos;s matches
        </h2>
        <p className="scout-qr-lede">
          Their phone has no signal? Scan the code on their screen, and this phone sends their matches to the team.
        </p>

        <div className="scout-qr-actions">
          {scanning ? (
            <Button variant="secondary" type="button" onClick={stopScan}>
              Stop camera
            </Button>
          ) : (
            <Button
              variant={hasQueue ? "secondary" : "primary"}
              type="button"
              disabled={busy}
              onClick={() => void startScan()}
            >
              Scan a teammate&apos;s code
            </Button>
          )}
        </div>

        <div className={["scout-qr-viewport", scanning ? "is-live" : ""].filter(Boolean).join(" ")} hidden={!scanning}>
          <video ref={videoRef} className="scout-qr-video" muted playsInline />
        </div>
        <canvas ref={canvasRef} className="scout-qr-canvas" hidden />

        <label className="scout-qr-manual">
          Or type the 8-letter code
          <input
            type="text"
            value={paste}
            onChange={(event) => setPaste(event.target.value)}
            placeholder="AB3D-EF7H"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <Button variant="secondary" type="button" disabled={busy || !paste.trim()} onClick={() => void ingestContent(paste)}>
          Take these matches
        </Button>
        {receiveNote ? (
          <p className="scout-qr-note" role="status">
            {receiveNote}
          </p>
        ) : null}
      </Panel>
    </div>
  );
}
