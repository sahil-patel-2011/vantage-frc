"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, TextField } from "../../components/ui";
import type { DriveMediaListing } from "../../lib/google-drive/drive-media";
import { RunTestButton } from "./run-test-button";

type Loaded =
  | { status: "ok"; canManage: boolean; listing: DriveMediaListing }
  | { status: "not_connected" | "unavailable"; canManage: boolean; message: string };

/**
 * Photos and videos in the team's own Google Drive, through the same Apps Script as the
 * spreadsheet. Set up once (a new folder, or one the team already uses), then Vantage tiles
 * whatever is in it on the Photos & videos page.
 */
export default function DriveMediaCard({ orgId }: { orgId: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [folder, setFolder] = useState("");
  const [share, setShare] = useState(false);
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(
    async (fresh = false) => {
      try {
        const response = await fetch(`/api/integrations/google/drive?orgId=${encodeURIComponent(orgId)}${fresh ? "&fresh=1" : ""}`, {
          cache: "no-store",
        });
        const data = (await response.json().catch(() => ({}))) as Loaded & { error?: string };
        if (!response.ok) {
          setLoaded({ status: "unavailable", canManage: false, message: data.error ?? "Couldn't load Google Drive." });
          return;
        }
        setLoaded(data);
        if (data.status === "ok") setShare(data.listing.shared);
      } catch {
        setLoaded({ status: "unavailable", canManage: false, message: "Couldn't reach Vantage. Check your connection." });
      }
    },
    [orgId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function setUp() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/integrations/google/drive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, action: "setup", folder: folder.trim(), shareWithLink: share }),
      });
      const data = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; root?: { name: string } };
      if (response.ok && data.ok) {
        setMessage({ ok: true, text: `Ready. Your media folder is “${data.root?.name ?? "Vantage media"}”.` });
        setChanging(false);
        setFolder("");
        await load(true);
      } else {
        setMessage({ ok: false, text: data.error ?? "Couldn't set up the folder. Try again." });
      }
    } catch {
      setMessage({ ok: false, text: "Couldn't reach Vantage. Check your connection." });
    }
    setBusy(false);
  }

  const listing = loaded?.status === "ok" ? loaded.listing : null;
  const root = listing?.root ?? null;
  const canManage = loaded?.canManage ?? false;
  const total = listing?.folders.reduce((sum, entry) => sum + entry.files.length, 0) ?? 0;

  return (
    <section className="app-card soft-panel connector-card drive-media-card" aria-labelledby="drive-media-title">
      <div className="connector-head">
        <div className="connector-identity">
          <h2 id="drive-media-title">Google Drive: photos and videos</h2>
          {loaded ? <Badge tone={root ? "good" : "neutral"}>{root ? "Connected" : "Not set up"}</Badge> : null}
        </div>
        <p className="connector-detail">
          Keep match videos and robot photos in your own Google Drive folder. Vantage organizes it into folders and shows
          everything in the app. Add files in Drive, from any phone or computer, at any size.
        </p>
      </div>

      {message ? (
        <p className={`connector-message${message.ok ? " success" : ""}`} role="status">
          {message.text}
        </p>
      ) : null}

      {!loaded ? (
        <p className="app-muted">Loading…</p>
      ) : loaded.status === "not_connected" ? (
        <p className="connector-status-line">Connect Google Sheets with Apps Script above first. The same script keeps your photos and videos.</p>
      ) : loaded.status !== "ok" ? (
        <p className="connector-status-line">{loaded.message}</p>
      ) : root && !changing ? (
        <>
          <ul className="drive-media-folders">
            {listing!.folders.map((entry) => (
              <li key={entry.key}>
                {entry.url ? (
                  <a href={entry.url} target="_blank" rel="noreferrer">
                    {entry.name}
                  </a>
                ) : (
                  <span>{entry.name}</span>
                )}
                <small>
                  {entry.files.length}
                  {entry.more ? "+" : ""}
                </small>
              </li>
            ))}
          </ul>
          <p className="app-muted">
            {total ? `${total} file${total === 1 ? "" : "s"} so far.` : "The folders are ready. Add files in Drive."}{" "}
            {listing!.shared ? "Anyone with a file's link can view it." : "Only people you share the folder with can open files."}
          </p>
          <div className="connector-actions">
            <Button as="a" variant="primary" size="sm" href={`/photos?orgId=${encodeURIComponent(orgId)}`}>
              Open photos and videos
            </Button>
            <Button as="a" variant="secondary" size="sm" href={root.url} target="_blank" rel="noreferrer">
              Open in Drive
            </Button>
            {canManage ? (
              <Button variant="ghost" size="sm" type="button" onClick={() => setChanging(true)}>
                Change folder or sharing
              </Button>
            ) : null}
          </div>
          {canManage ? <RunTestButton endpoint="/api/integrations/google/drive" body={{ orgId }} /> : null}
        </>
      ) : canManage ? (
        <div className="drive-media-setup">
          <TextField
            label="Drive folder (optional)"
            help="Paste a link to a folder your team already uses, or leave this empty and Vantage makes a new one."
            placeholder="https://drive.google.com/drive/folders/…"
            value={folder}
            onChange={(event) => setFolder(event.target.value)}
            spellCheck={false}
            autoComplete="off"
            wide
          />
          <label className="drive-media-share">
            <input type="checkbox" checked={share} onChange={(event) => setShare(event.target.checked)} />
            Let anyone with a file&apos;s link view it, so teammates can watch videos without asking for access
          </label>
          <div className="connector-actions">
            <Button variant="primary" size="sm" type="button" disabled={busy} onClick={() => void setUp()}>
              {busy ? "Setting up…" : root ? "Save" : "Set up folder"}
            </Button>
            {changing ? (
              <Button variant="ghost" size="sm" type="button" disabled={busy} onClick={() => setChanging(false)}>
                Cancel
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="connector-status-line">A team owner or admin can set up the media folder here.</p>
      )}
    </section>
  );
}
