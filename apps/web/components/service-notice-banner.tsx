"use client";

import { useEffect, useState } from "react";
import {
  bannerLinks,
  copiesFromMirrorStatus,
  readSheetCopies,
  rememberSheetCopies,
  shouldRefreshSheetCopies,
  type SheetCopyCache,
} from "../lib/outage/sheet-copies";
import "./service-notice-banner.css";

type Status = { limited: boolean; message?: string; since?: string };

const DISMISSED_KEY = "vantage.service-notice.dismissed";
const POLL_MS = 3 * 60 * 1000;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * "Vantage is limited right now": shown in the app when the owner turned the notice on from the
 * outage console (GET /api/status, which reads no database). Calm, dismissible until the next
 * notice, and with links to the team's spreadsheet copy that this device remembered while
 * everything worked.
 *
 * `cacheOrgId` is set only when the shell loaded normally (signed in, a team chosen): that is
 * when the team's copy links are fetched and remembered, at most twice a day.
 */
export function ServiceNoticeBanner({ cacheOrgId, orgLabel }: { cacheOrgId: string | null; orgLabel: string | null }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [copies, setCopies] = useState<SheetCopyCache>({});

  useEffect(() => {
    setCopies(readSheetCopies(storage()));
    try {
      setDismissed(storage()?.getItem(DISMISSED_KEY) ?? null);
    } catch {
      // Private mode: the notice shows until closed on this page.
    }
    let cancelled = false;
    const check = () => {
      if (document.visibilityState !== "visible") return;
      void fetch("/api/status")
        .then((response) => (response.ok ? (response.json() as Promise<Status>) : null))
        .then((next) => {
          if (!cancelled && next) setStatus(next);
        })
        .catch(() => undefined);
    };
    check();
    const timer = window.setInterval(check, POLL_MS);
    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("online", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  // Remember the team's spreadsheet links while Vantage works (skipped when not connected).
  useEffect(() => {
    if (!cacheOrgId || !shouldRefreshSheetCopies(readSheetCopies(storage()), cacheOrgId)) return;
    let cancelled = false;
    void fetch(`/api/integrations/mirror/status?orgId=${encodeURIComponent(cacheOrgId)}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: unknown) => {
        if (cancelled || !body) return;
        setCopies(rememberSheetCopies(storage(), cacheOrgId, orgLabel, copiesFromMirrorStatus(body)));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [cacheOrgId, orgLabel]);

  if (!status?.limited || (status.since && dismissed === status.since)) return null;

  const links = bannerLinks(copies, cacheOrgId);
  const close = () => {
    const key = status.since ?? "now";
    setDismissed(key);
    try {
      storage()?.setItem(DISMISSED_KEY, key);
    } catch {
      // Closed for this page only.
    }
  };

  return (
    <section className="service-notice" role="status" aria-live="polite" aria-label="Vantage is limited right now">
      <div className="service-notice-text">
        <strong>Vantage is limited right now</strong>
        {status.message ? <span>{status.message}</span> : null}
        {links.length ? (
          <span className="service-notice-links">
            {links.map((link) => (
              <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer">
                Open {links.length > 1 && link.team ? `${link.team}’s` : "your team’s"} spreadsheet copy
                {link.kind === "excel" ? " (Excel)" : " (Google Sheets)"}
              </a>
            ))}
          </span>
        ) : null}
      </div>
      <button type="button" className="service-notice-close" onClick={close} aria-label="Hide this notice">
        Hide
      </button>
    </section>
  );
}
