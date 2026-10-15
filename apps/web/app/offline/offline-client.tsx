"use client";

import "../product-styles";
import { useEffect, useState } from "react";

import { getLastOrgId, pendingCounts } from "../../lib/scout-offline";
import {
  OFFLINE_BOOT_RELATED_INCLUDE,
  offlineBootNextActions,
  offlineBootStatusLine,
  offlineRelatedLinks,
  offlineShellCopy,
} from "../../lib/offline/offline-related";

/**
 * Where the browser was actually going. The service worker serves this page's cached HTML in
 * place of a page whose navigation failed, so the address bar still names that page. Read once
 * when this module loads, before the router can touch history.
 */
const ARRIVED_AT =
  typeof window === "undefined" ? null : { path: window.location.pathname, href: window.location.href };

/**
 * Cold offline boot UI. Served from the SW shell cache when navigation fails.
 * Soft-UI: readiness, clear next actions, Scouting first — never DEMO sync counts.
 */
export default function OfflineClient() {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [counts, setCounts] = useState({ entries: 0, media: 0 });
  const [loaded, setLoaded] = useState(false);
  const [online, setOnline] = useState(true);
  // Stood in for another page (the worker's fallback), rather than opened as /offline itself.
  const [failedHref, setFailedHref] = useState<string | null>(null);

  useEffect(() => {
    if (ARRIVED_AT && ARRIVED_AT.path !== "/offline" && ARRIVED_AT.path !== "/offline/") {
      setFailedHref(ARRIVED_AT.href);
      if (navigator.onLine) document.title = "Couldn't load page · Vantage";
    }
    setOnline(navigator.onLine);
    void (async () => {
      setOrgId(await getLastOrgId());
      setCounts(await pendingCounts());
      setLoaded(true);
    })();
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const copy = offlineShellCopy(online ? "ready" : "offline_cold");
  const actions = offlineBootNextActions({
    orgId,
    online,
    loaded,
    pendingEntries: counts.entries,
    pendingMedia: counts.media,
  });
  const related = offlineRelatedLinks(orgId, { include: [...OFFLINE_BOOT_RELATED_INCLUDE] });
  const status = offlineBootStatusLine({
    online,
    loaded,
    entries: counts.entries,
    media: counts.media,
    orgRemembered: Boolean(orgId),
  });

  return (
    <main className="offline-shell">
      <p className="offline-shell-brand">Vantage</p>
      {copy.badge ? <span className={`app-badge ${online ? "good" : "setup"}`}>{copy.badge}</span> : null}
      {failedHref && online ? (
        <>
          {/* Online, but the page did not arrive: say that, not "offline". */}
          <h1>Couldn&apos;t load that page</h1>
          <p className="offline-shell-lead">
            The connection dropped before Vantage answered. Your device still reports a connection, so try
            again — scout data saved on this phone is safe either way.
          </p>
          <button type="button" className="offline-shell-retry" onClick={() => window.location.replace(failedHref)}>
            Try again
          </button>
        </>
      ) : (
        <>
          <h1>{online ? "Ready when the Wi-Fi drops" : copy.title}</h1>
          <p className="offline-shell-lead">
            {online
              ? "Pages you open while online stay on this phone. Open Scouting once before you lose signal — queued scout counts come from this device only."
              : copy.description}
          </p>
          {failedHref ? (
            <button type="button" className="offline-shell-retry" onClick={() => window.location.replace(failedHref)}>
              Try again
            </button>
          ) : null}
        </>
      )}
      <p className="offline-shell-status" role="status">
        {status}
      </p>

      <section className="offline-shell-next" aria-label="Next actions">
        <header>
          <h2>Next actions</h2>
          <p>Entries queued on this device. Counts stay at zero until you scout.</p>
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

      <nav className="offline-shell-related" aria-label="Related offline tools">
        {related.map((link) => (
          <a key={link.id} href={link.href}>{link.label}</a>
        ))}
      </nav>

      <p className="offline-shell-hint">
        Tip: open Scouting, Schedule, and This phone once while online at the event so a cold launch still
        works with no signal. Scout data stays on this device until sync.
      </p>
    </main>
  );
}
