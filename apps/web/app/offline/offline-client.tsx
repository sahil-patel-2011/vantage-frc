"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getLastOrgId, pendingCounts } from "../../lib/scout-offline";

type ShellLink = {
  href: string;
  label: string;
  detail: string;
};

/**
 * Cold offline boot UI. Served from the SW shell cache when navigation fails.
 * Deep-links scouting with the last orgId remembered in the IndexedDB outbox DB.
 */
export default function OfflineClient() {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [counts, setCounts] = useState({ entries: 0, media: 0 });
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    void (async () => {
      setOrgId(await getLastOrgId());
      setCounts(await pendingCounts());
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

  const scoutHref = orgId ? `/scouting?orgId=${encodeURIComponent(orgId)}` : "/scouting";
  const withOrg = (path: string) =>
    orgId ? `${path}?orgId=${encodeURIComponent(orgId)}` : path;

  const links: ShellLink[] = [
    {
      href: scoutHref,
      label: "Scouting",
      detail: orgId
        ? "Match and pit forms + IndexedDB outbox on this device"
        : "Open once online from a workspace so the event cache is ready",
    },
    {
      href: withOrg("/team/calendar"),
      label: "Team calendar",
      detail: "Last schedule cached on this device",
    },
    {
      href: withOrg("/calendar"),
      label: "Season calendar",
      detail: "Milestones from your last online load",
    },
    {
      href: withOrg("/todos"),
      label: "Todos",
      detail: "Team action items from cache",
    },
    {
      href: withOrg("/logistics"),
      label: "Logistics",
      detail: "Hotel, travel, and day-of checklists",
    },
  ];

  return (
    <main className="offline-shell">
      <p className="offline-shell-brand">Vantage</p>
      <h1>{online ? "Offline shell ready" : "You're offline"}</h1>
      <p className="offline-shell-lead">
        {online
          ? "This shell is precached for venue Wi-Fi drops. Open scouting once while online so a cold no-signal load still works."
          : "Venue Wi-Fi dropped. Open a page you've already visited — it loads from the app shell cache. Scouting keeps saving to the on-device outbox until sync returns."}
      </p>
      <p className="offline-shell-status" role="status">
        {online ? "Online" : "Offline"}
        {counts.entries || counts.media
          ? ` · ${counts.entries} scout entries · ${counts.media} media queued`
          : " · scout outbox empty"}
        {orgId ? " · workspace remembered" : ""}
      </p>
      <ul className="offline-shell-links">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href}>
              <strong>{link.label}</strong>
              <span>{link.detail}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="offline-shell-hint">
        Tip: open each of these once while online at the event so a cold launch still works with no
        signal. Scout data never leaves this device until sync.
      </p>
    </main>
  );
}
