"use client";

import { toDataURL as qrDataUrl } from "qrcode";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui";
import { displayKioskHref, pitChromiumKioskCommand } from "../../lib/display";

type Check = { state: "idle" | "checking" | "ok" | "failed"; detail: string };

/**
 * The link a TV opens, shown once right after it is made. The event board is the one to use:
 * it follows the event (next match with bumper colour and opponents, queue, rankings, bracket)
 * on its own. A QR code saves typing a 60-character address with a TV remote, and "Test" opens
 * the same feed the TV will, so a dead link is found at the laptop, not at the TV.
 */
export function TvLinkPanel({ token, onCopied }: { token: string; onCopied: (message: string) => void }) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const eventBoard = displayKioskHref(origin, token, "stage");
  const simpleBoard = displayKioskHref(origin, token, "pit");
  const [qr, setQr] = useState<string | null>(null);
  const [check, setCheck] = useState<Check>({ state: "idle", detail: "" });

  useEffect(() => {
    let active = true;
    void qrDataUrl(eventBoard, { margin: 1, width: 220 })
      .then((url) => {
        if (active) setQr(url);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [eventBoard]);

  const copy = (url: string, message: string) => {
    void navigator.clipboard
      .writeText(url)
      .then(() => onCopied(message))
      .catch(() => onCopied("Couldn't copy automatically. Select the link and copy it by hand."));
  };

  const test = async () => {
    setCheck({ state: "checking", detail: "" });
    try {
      const response = await fetch(`/api/display/stage?token=${encodeURIComponent(token)}`, { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as { error?: string; board?: { name?: string } };
      if (response.ok && body.board) {
        setCheck({ state: "ok", detail: `Works. The TV will show "${body.board.name ?? "your board"}".` });
      } else {
        setCheck({ state: "failed", detail: body.error ?? "This link didn't load. Make a new one." });
      }
    } catch {
      setCheck({ state: "failed", detail: "Couldn't reach Vantage from this laptop. Check the connection and try again." });
    }
  };

  return (
    <div className="token-once tv-link">
      <div className="tv-link-main">
        <strong>TV link ready. Copy it now: it is shown only once.</strong>
        <p className="app-muted">
          Open it in the TV&rsquo;s browser (or on the laptop plugged into the TV) and press F11 for full screen. It
          shows your next match, bumper colour and opponents, and switches to rankings and the bracket as the event
          goes on.
        </p>
        <code className="tv-link-url">{eventBoard}</code>
        <div className="display-actions">
          <Button variant="primary" type="button" onClick={() => copy(eventBoard, "TV link copied.")}>
            Copy TV link
          </Button>
          <Button variant="secondary" type="button" disabled={check.state === "checking"} onClick={() => void test()}>
            {check.state === "checking" ? "Testing…" : "Test this TV link"}
          </Button>
        </div>
        {check.state === "ok" || check.state === "failed" ? (
          <p role="status" className={check.state === "ok" ? "tv-link-ok" : "tv-link-bad"}>
            {check.detail}
          </p>
        ) : null}
        <details className="tv-link-more">
          <summary>Other ways to show it</summary>
          <p>
            Simpler one-screen board (no rotation):{" "}
            <button type="button" className="app-link" onClick={() => copy(simpleBoard, "Simple board link copied.")}>
              copy link
            </button>
          </p>
          <p>
            Raspberry Pi or a kiosk stick, starting full screen on boot:
            <code>{pitChromiumKioskCommand(eventBoard)}</code>
          </p>
        </details>
      </div>
      {qr ? (
        <figure className="tv-link-qr">
          {/* A data URL made in the browser; next/image adds nothing for it. */}
          <img src={qr} alt="QR code for the TV link" width={220} height={220} />
          <figcaption>Scan with a phone or tablet that is driving the TV.</figcaption>
        </figure>
      ) : null}
    </div>
  );
}
