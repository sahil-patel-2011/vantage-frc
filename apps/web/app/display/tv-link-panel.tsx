"use client";

import { toDataURL as qrDataUrl } from "qrcode";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui";
import { displayKioskHref, pitChromiumKioskCommand } from "../../lib/display";

type Check = { state: "idle" | "checking" | "ok" | "failed"; detail: string };

/**
 * The link a TV opens, shown once right after it is made. It shows what was picked: the event
 * board (rotates through next match, queue, rankings and bracket on its own) or a board the team
 * built, exactly as "Open fullscreen" does. The other screen is offered beside it, named as the
 * different thing it is. A QR code saves typing a 60-character address with a TV remote, and
 * "Test" opens the same feed the TV will, so a dead link is found at the laptop.
 */
export function TvLinkPanel({
  token,
  mode = "pit",
  boardName,
  onCopied,
}: {
  token: string;
  mode?: "pit" | "stage";
  boardName?: string;
  onCopied: (message: string) => void;
}) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const eventMode = mode === "stage";
  const yourBoard = displayKioskHref(origin, token, eventMode ? "stage" : "pit");
  const eventBoard = displayKioskHref(origin, token, eventMode ? "pit" : "stage");
  const [qr, setQr] = useState<string | null>(null);
  const [check, setCheck] = useState<Check>({ state: "idle", detail: "" });

  useEffect(() => {
    let active = true;
    void qrDataUrl(yourBoard, { margin: 1, width: 220 })
      .then((url) => {
        if (active) setQr(url);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [yourBoard]);

  const copy = (url: string, message: string) => {
    void navigator.clipboard
      .writeText(url)
      .then(() => onCopied(message))
      .catch(() => onCopied("Couldn't copy automatically. Select the link and copy it by hand."));
  };

  const test = async () => {
    setCheck({ state: "checking", detail: "" });
    try {
      const response = await fetch(`/api/display/snapshot?token=${encodeURIComponent(token)}`, { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as { error?: string; board?: { name?: string } };
      if (response.ok && body.board) {
        setCheck({
          state: "ok",
          detail: eventMode ? "Works. The TV will show the event board." : `Works. The TV will show "${body.board.name ?? "your board"}".`,
        });
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
          It shows {eventMode ? "the event board" : `"${boardName ?? "this board"}" exactly as you built it`}. Nobody types
          this link on a TV remote; pick the way that matches your setup:
        </p>
        {/* A 43-character token cannot be typed with a remote; say how each usual setup gets it there. */}
        <ol className="tv-link-ways">
          <li>
            <strong>Laptop plugged into the TV (HDMI):</strong> copy the link, open it on that laptop, then press the
            board&rsquo;s Fullscreen button.
          </li>
          <li>
            <strong>Smart TV, Chromecast or Fire stick:</strong> scan the QR code with a phone, open the link, then cast
            that tab or screen to the TV.
          </li>
          <li>
            <strong>Mini PC or Raspberry Pi on the TV:</strong> use the start-up command under Other ways to show it.
          </li>
        </ol>
        <code className="tv-link-url">{yourBoard}</code>
        <div className="display-actions">
          <Button variant="primary" type="button" onClick={() => copy(yourBoard, "TV link copied.")}>
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
          {eventMode ? (
            <p>
              <strong>This board&rsquo;s own panels instead</strong>: shows {boardName ? `"${boardName}"` : "the saved board"} as
              it was built rather than the event board.{" "}
              <button type="button" className="text-button" onClick={() => copy(eventBoard, "Board link copied.")}>
                Copy board link
              </button>
            </p>
          ) : (
            <p>
              <strong>Event board instead</strong>: ignores this board&rsquo;s layout and rotates on its own through the next
              match (bumper colour, who you&rsquo;re with and against), the queue, rankings and the bracket.{" "}
              <button type="button" className="text-button" onClick={() => copy(eventBoard, "Event board link copied.")}>
                Copy event board link
              </button>
            </p>
          )}
          <p>
            Raspberry Pi or a kiosk stick, starting full screen on boot:
            <code>{pitChromiumKioskCommand(yourBoard)}</code>
          </p>
        </details>
      </div>
      {qr ? (
        <figure className="tv-link-qr">
          {/* A data URL made in the browser; next/image adds nothing for it. */}
          <img src={qr} alt="QR code for the TV link" width={220} height={220} />
          <figcaption>Scan with the phone or tablet you will cast to the TV.</figcaption>
        </figure>
      ) : null}
    </div>
  );
}
