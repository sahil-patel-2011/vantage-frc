"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, EmptyState, Modal, PageHeader } from "../../components/ui";
import type { DriveMediaFile, DriveMediaListing } from "../../lib/google-drive/drive-media";
import "./photos.css";

type Loaded =
  | { status: "ok"; canManage: boolean; listing: DriveMediaListing; cachedAt?: string }
  | { status: "not_connected" | "unavailable"; canManage: boolean; message: string };

function kindOf(file: DriveMediaFile): "video" | "photo" | "file" {
  if (file.mimeType.startsWith("video/")) return "video";
  if (file.mimeType.startsWith("image/")) return "photo";
  return "file";
}

function sizeLabel(bytes: number): string {
  if (!bytes) return "";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Photos and videos, tiled from the team's Google Drive folder (lib/google-drive). Nothing
 * is stored by Vantage: thumbnails come from Drive, and opening a tile plays or shows the
 * file with Drive's own viewer.
 */
export default function PhotosClient() {
  const [orgId, setOrgId] = useState("");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [folderKey, setFolderKey] = useState("all");
  const [open, setOpen] = useState<DriveMediaFile | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (id: string, fresh = false) => {
    if (!id) {
      setLoaded({ status: "not_connected", canManage: false, message: "Choose your team to see its photos and videos." });
      return;
    }
    try {
      const response = await fetch(`/api/integrations/google/drive?orgId=${encodeURIComponent(id)}${fresh ? "&fresh=1" : ""}`, {
        cache: "no-store",
      });
      const data = (await response.json().catch(() => ({}))) as Loaded & { error?: string };
      setLoaded(response.ok ? data : { status: "unavailable", canManage: false, message: data.error ?? "Couldn't load photos and videos." });
    } catch {
      setLoaded({ status: "unavailable", canManage: false, message: "Couldn't reach Vantage. Check your connection." });
    }
  }, []);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("orgId") ?? "";
    setOrgId(id);
    void load(id);
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    await load(orgId, true);
    setRefreshing(false);
  }

  const listing = loaded?.status === "ok" ? loaded.listing : null;
  const folders = useMemo(() => listing?.folders ?? [], [listing]);
  const files = useMemo(
    () =>
      folders
        .filter((entry) => folderKey === "all" || entry.key === folderKey)
        .flatMap((entry) => entry.files.map((file) => ({ file, folder: entry.name })))
        .sort((a, b) => Date.parse(b.file.updated) - Date.parse(a.file.updated)),
    [folders, folderKey],
  );
  const current = folders.find((entry) => entry.key === folderKey);
  const addHref = current?.url ?? listing?.root?.url ?? null;

  return (
    <main className="module-page photos-page">
      <PageHeader
        breadcrumbs="Team / Photos and videos"
        title="Photos and videos"
        description="Your team's match videos and photos, straight from its Google Drive folder."
      >
        {listing?.root ? (
          <>
            {addHref ? (
              <Button as="a" variant="primary" href={addHref} target="_blank" rel="noreferrer">
                Add files in Drive
              </Button>
            ) : null}
            <Button variant="secondary" type="button" disabled={refreshing} onClick={() => void refresh()}>
              {refreshing ? "Refreshing…" : "Refresh"}
            </Button>
          </>
        ) : null}
      </PageHeader>

      {!loaded ? (
        <div className="photos-grid" aria-busy="true">
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="photos-tile photos-tile--skeleton" />
          ))}
        </div>
      ) : loaded.status !== "ok" || !listing?.root ? (
        <EmptyState
          soft
          badge="Set up"
          badgeTone="setup"
          title="Connect your team's Google Drive"
          description={
            loaded.status !== "ok"
              ? loaded.message
              : "Your team hasn't picked a media folder yet. It takes one click under Connectors."
          }
        >
          {loaded.canManage || loaded.status === "ok" ? (
            <Button as="a" variant="primary" href={orgId ? `/connectors?orgId=${encodeURIComponent(orgId)}` : "/connectors"}>
              Open Connectors
            </Button>
          ) : null}
        </EmptyState>
      ) : (
        <>
          <nav className="photos-filters" aria-label="Folders">
            {[{ key: "all", name: "Everything" }, ...folders].map((entry) => (
              <button
                key={entry.key}
                type="button"
                className={`photos-chip${folderKey === entry.key ? " is-active" : ""}`}
                aria-pressed={folderKey === entry.key}
                onClick={() => setFolderKey(entry.key)}
              >
                {entry.name}
                {"files" in entry ? <small>{entry.files.length}</small> : null}
              </button>
            ))}
          </nav>

          {files.length === 0 ? (
            <EmptyState
              soft
              title="Nothing here yet"
              description="Drop photos and videos into this folder in Google Drive and they show up here."
            >
              {addHref ? (
                <Button as="a" variant="primary" href={addHref} target="_blank" rel="noreferrer">
                  Add files in Drive
                </Button>
              ) : null}
            </EmptyState>
          ) : (
            <ul className="photos-grid">
              {files.map(({ file, folder }) => {
                const kind = kindOf(file);
                return (
                  <li key={file.id}>
                    <button type="button" className="photos-tile" onClick={() => setOpen(file)} aria-label={`Open ${file.name}`}>
                      {file.thumb ? (
                        <img src={file.thumb} alt="" loading="lazy" />
                      ) : (
                        <span className="photos-tile-icon" aria-hidden="true">
                          {kind === "video" ? "▶" : kind === "photo" ? "▦" : "▤"}
                        </span>
                      )}
                      {kind === "video" && file.thumb ? (
                        <span className="photos-tile-play" aria-hidden="true">
                          ▶
                        </span>
                      ) : null}
                      <span className="photos-tile-caption">
                        <strong>{file.name}</strong>
                        <small>
                          {folder}
                          {file.size ? ` · ${sizeLabel(file.size)}` : ""}
                        </small>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {folders.some((entry) => entry.more) ? (
            <p className="app-muted">Showing the newest files in each folder. Open the folder in Drive to see everything.</p>
          ) : null}
        </>
      )}

      <Modal open={Boolean(open)} onClose={() => setOpen(null)} title={open?.name ?? ""} className="photos-viewer">
        {open ? (
          <div className="photos-viewer-body">
            <iframe
              title={open.name}
              src={`https://drive.google.com/file/d/${encodeURIComponent(open.id)}/preview`}
              allow="autoplay; fullscreen"
              allowFullScreen
            />
            <p className="app-muted">
              {listing?.shared
                ? "Playing from Google Drive."
                : "If this stays blank, ask the folder's owner to share it with your Google account, or open it in Drive."}
            </p>
            <div className="connector-actions">
              <Button as="a" variant="secondary" href={open.url} target="_blank" rel="noreferrer">
                Open in Drive
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </main>
  );
}
