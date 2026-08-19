"use client";

import Link from "next/link";
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
 * Cold offline boot UI. Served from the SW shell cache when navigation fails.
 * Soft-UI: readiness, clear next actions, Scouting first — never DEMO sync counts.
 */
export default function OfflineClient() {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [counts, setCounts] = useState({ entries: 0, media: 0 });
  const [loaded, setLoaded] = useState(false);
  const [online, setOnline] = useState(true);

  useEffect(() => {
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
      <h1>{online ? "Offline shell ready" : copy.title}</h1>
      <p className="offline-shell-lead">
        {online
          ? "This shell is precached for venue Wi-Fi drops. Open Scouting once while online so a cold no-signal load still works — outbox counts come from this device only."
          : copy.description}
      </p>
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
              <div>
                <strong>{action.label}</strong>
                <span>{action.detail}</span>
              </div>
              <Link className="app-button secondary" href={action.href}>
                Open
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <nav className="offline-shell-related" aria-label="Related offline tools">
        {related.map((link) => (
          <Link key={link.id} className="app-button secondary" href={link.href}>
            {link.label}
          </Link>
        ))}
      </nav>

      <p className="offline-shell-hint">
        Tip: open Scouting, Schedule, and Offline Shell once while online at the event so a cold launch still
        works with no signal. Scout data never leaves this device until sync.
      </p>
    </main>
  );
}
