"use client";

import { useEffect, useState } from "react";

type HubSheet = {
  configured: boolean;
  status?: string;
  url?: string | null;
  name?: string | null;
  lastSyncAt?: string | null;
  error?: string | null;
};

function ago(iso: string | null | undefined): string {
  if (!iso) return "not yet";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * The team's spreadsheet in the VantageFRC folder, when the platform keeps one. Owners and
 * admins only: opening this brings the sheet up to date, and the server refuses anyone else.
 * Renders nothing when the platform has no team-sheets hub.
 */
export function TeamHubSheet({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const [sheet, setSheet] = useState<HubSheet | null>(null);

  useEffect(() => {
    if (!orgId || !canManage) return;
    let active = true;
    void fetch(`/api/integrations/sheets/auto?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<HubSheet>) : null))
      .then((data) => {
        if (active) setSheet(data);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [orgId, canManage]);

  if (!sheet?.configured) return null;
  return (
    <section className="app-card soft-panel team-hub-sheet" aria-labelledby="team-hub-sheet-title">
      <div>
        <span className="eyebrow">Google Sheets</span>
        <h2 id="team-hub-sheet-title">Your team&rsquo;s sheet</h2>
        <p className="app-muted">
          {sheet.name ?? "Your team's spreadsheet"} · updates on its own while people use Vantage · last updated{" "}
          {ago(sheet.lastSyncAt)}
        </p>
        {sheet.error ? <p role="status">{sheet.error}</p> : null}
      </div>
      {sheet.url ? (
        <a className="app-button secondary" href={sheet.url} target="_blank" rel="noreferrer">
          Open sheet
        </a>
      ) : null}
    </section>
  );
}
