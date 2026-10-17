"use client";

import { useEffect, useState } from "react";
import { renderQrDataUrl } from "../../../lib/scouting/qr-camera";
import { friendlyErrorMessage } from "../../../lib/ui/friendly-error";

/** Ask for a fresh code a little before the current one changes. */
const REFRESH_EARLY_MS = 5_000;

/**
 * The shop-door screen: one big QR code that changes every minute. A member scans it with their
 * phone's camera, which opens Vantage and checks them in (or out, if they're already in). Open it
 * on a tablet or laptop by the door; only owners and admins can.
 */
export default function DoorClient() {
  const [orgId, setOrgId] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    setOrgId(new URLSearchParams(window.location.search).get("orgId") ?? "");
  }, []);

  useEffect(() => {
    if (!orgId) return;
    let timer: number | undefined;
    let stopped = false;
    const refresh = async () => {
      try {
        const response = await fetch(`/api/hours/door?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store" });
        const data = (await response.json().catch(() => ({}))) as { path?: string; expiresAt?: number; error?: string };
        if (stopped) return;
        if (!response.ok || !data.path || !data.expiresAt) {
          setProblem(data.error ?? "The door code couldn't load.");
          timer = window.setTimeout(refresh, 15_000);
          return;
        }
        setProblem(null);
        setQr(await renderQrDataUrl(new URL(data.path, window.location.origin).href, 520));
        timer = window.setTimeout(refresh, Math.max(5_000, data.expiresAt - Date.now() - REFRESH_EARLY_MS));
      } catch (error) {
        if (stopped) return;
        setProblem(friendlyErrorMessage(error, "The door code couldn't load."));
        timer = window.setTimeout(refresh, 15_000);
      }
    };
    void refresh();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [orgId]);

  return (
    <main className="module-page door-page">
      <h1>Scan to check in or out</h1>
      <p className="app-muted">Open your phone&apos;s camera and point it at the code. It changes every minute.</p>
      {qr ? <img className="door-qr" src={qr} alt="Check-in code" width={520} height={520} /> : <div className="door-qr door-qr-wait" aria-busy="true" />}
      {problem ? <p className="door-problem" role="alert">{problem}</p> : null}
      {!orgId ? <p className="app-muted">Open this page from Hours so it knows your team.</p> : null}
    </main>
  );
}
