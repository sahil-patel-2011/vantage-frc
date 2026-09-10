"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  Panel,
  SoftBlockSkeleton, Button } from "../../components/ui";
import {
  albumItemCounts,
  collectFilterOptions,
  filterMediaItems,
  originLabel,
  NO_ALBUM,
  type MediaFilter,
} from "../../lib/media-library/library-filters";
import type {
  MediaKind,
  MediaLibraryItem,
  MediaLibraryView,
  MediaOrigin,
} from "../../lib/media-library/types";
import {
  PHOTO_DB_CAP_BYTES,
  THUMBNAIL_JPEG_QUALITY,
  THUMBNAIL_MAX_EDGE,
  VIDEO_DB_CAP_BYTES,
  formatMediaBytes,
  mediaKindForContentType,
  oversizeUploadMessage,
} from "../../lib/media-library/validation";
import {
  DOWNSCALE_JPEG_QUALITY,
  downscaleDimensions,
  isDownscalableImageType,
} from "../../lib/scouting/media-downscale";
import "./media-library.css";

type LiveView = Extract<MediaLibraryView, { status: "live" }>;

type UploadProgress = {
  key: string;
  name: string;
  state: "preparing" | "uploading" | "done" | "duplicate" | "error";
  message?: string;
};

// ---- client-side media preparation (canvas work stays in this component;
// the pure maths live in lib/scouting/media-downscale + lib/media-library) ----

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read image"));
    };
    image.src = url;
  });
}

function drawToBlob(
  source: CanvasImageSource,
  width: number,
  height: number,
  quality: number,
): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return Promise.resolve(null);
  context.drawImage(source, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

type PreparedPhoto = {
  blob: Blob;
  contentType: string;
  width: number;
  height: number;
  thumbnailBase64: string | null;
};

/** Downscale a photo via canvas (client-side) and build its thumbnail. */
async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const image = await loadImage(file);
  const natural = { width: image.naturalWidth, height: image.naturalHeight };
  const target = downscaleDimensions(natural.width, natural.height);

  let blob: Blob = file;
  let contentType = file.type;
  let width = natural.width;
  let height = natural.height;
  if (
    isDownscalableImageType(file.type) &&
    (target.scaled || file.size > PHOTO_DB_CAP_BYTES) &&
    target.width > 0
  ) {
    const encoded = await drawToBlob(image, target.width, target.height, DOWNSCALE_JPEG_QUALITY);
    if (encoded) {
      blob = encoded;
      contentType = "image/jpeg";
      width = target.width;
      height = target.height;
    }
  }

  let thumbnailBase64: string | null = null;
  const thumbDims = downscaleDimensions(natural.width, natural.height, THUMBNAIL_MAX_EDGE);
  if (thumbDims.width > 0) {
    const thumb = await drawToBlob(image, thumbDims.width, thumbDims.height, THUMBNAIL_JPEG_QUALITY);
    if (thumb) thumbnailBase64 = await blobToBase64(thumb);
  }
  return { blob, contentType, width, height, thumbnailBase64 };
}

type VideoProbe = {
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  thumbnailBase64: string | null;
};

/**
 * Capture a poster frame client-side by seeking a <video> element and drawing
 * it to a canvas — genuinely capturable in-browser, no server transcoding.
 * Best-effort: metadata still uploads if the codec cannot render here.
 */
function probeVideo(file: File): Promise<VideoProbe> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    const finish = (probe: VideoProbe) => {
      URL.revokeObjectURL(url);
      resolve(probe);
    };
    const timer = window.setTimeout(
      () => finish({ width: null, height: null, durationSeconds: null, thumbnailBase64: null }),
      15000,
    );
    video.onerror = () => {
      window.clearTimeout(timer);
      finish({ width: null, height: null, durationSeconds: null, thumbnailBase64: null });
    };
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
      video.currentTime = duration ? Math.min(1, duration * 0.1) : 0;
    };
    video.onseeked = async () => {
      window.clearTimeout(timer);
      const width = video.videoWidth || null;
      const height = video.videoHeight || null;
      const durationSeconds =
        Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
      let thumbnailBase64: string | null = null;
      if (width && height) {
        const dims = downscaleDimensions(width, height, THUMBNAIL_MAX_EDGE);
        const poster = await drawToBlob(video, dims.width, dims.height, THUMBNAIL_JPEG_QUALITY);
        if (poster) thumbnailBase64 = await blobToBase64(poster);
      }
      finish({ width, height, durationSeconds, thumbnailBase64 });
    };
    video.src = url;
  });
}

function defaultTitle(fileName: string): string {
  const base = fileName.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim();
  return (base || fileName || "Untitled").slice(0, 200);
}

function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

// ---- component ----

export default function MediaLibraryClient() {
  const [view, setView] = useState<MediaLibraryView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<MediaFilter>({
    albumId: "all",
    kind: "all",
    eventKey: "all",
    subteam: "all",
    origin: "all",
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadProgress[]>([]);
  const [albumFormOpen, setAlbumFormOpen] = useState(false);
  const [albumName, setAlbumName] = useState("");
  const [albumEvent, setAlbumEvent] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const orgId =
        typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("orgId");
      const response = await fetch(
        orgId ? `/api/media-library?orgId=${encodeURIComponent(orgId)}` : "/api/media-library",
      );
      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      setView((await response.json()) as MediaLibraryView);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load the media library");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const live: LiveView | null = view?.status === "live" ? view : null;

  const options = useMemo(() => collectFilterOptions(live?.items ?? []), [live]);
  const filtered = useMemo(() => filterMediaItems(live?.items ?? [], filter), [live, filter]);
  const perAlbum = useMemo(() => albumItemCounts(live?.items ?? []), [live]);
  const selected = useMemo(
    () => (selectedId ? (live?.items ?? []).find((item) => item.id === selectedId) ?? null : null),
    [selectedId, live],
  );

  const postAction = useCallback(
    async (body: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
      if (!live) return null;
      setActionError(null);
      const response = await fetch("/api/media-library", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId: live.orgId, ...body }),
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        setActionError(typeof payload.error === "string" ? payload.error : "Request failed");
        return null;
      }
      return payload;
    },
    [live],
  );

  const setProgress = useCallback((key: string, patch: Partial<UploadProgress>) => {
    setUploads((current) => current.map((u) => (u.key === key ? { ...u, ...patch } : u)));
  }, []);

  const uploadFiles = useCallback(
    async (files: FileList | null) => {
      if (!files?.length || !live) return;
      const albumId =
        filter.albumId !== "all" && filter.albumId !== NO_ALBUM ? filter.albumId : null;

      for (const file of Array.from(files)) {
        const key = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        setUploads((current) => [...current, { key, name: file.name, state: "preparing" }]);

        try {
          const kind = mediaKindForContentType(file.type);
          if (!kind) {
            setProgress(key, {
              state: "error",
              message: "Unsupported format. Photos: JPEG/PNG/WebP. Videos: MP4/WebM.",
            });
            continue;
          }

          let blob: Blob = file;
          let contentType = file.type;
          let width: number | null = null;
          let height: number | null = null;
          let durationSeconds: number | null = null;
          let thumbnailBase64: string | null = null;

          if (kind === "photo") {
            const prepared = await preparePhoto(file);
            blob = prepared.blob;
            contentType = prepared.contentType;
            width = prepared.width;
            height = prepared.height;
            thumbnailBase64 = prepared.thumbnailBase64;
            if (blob.size > PHOTO_DB_CAP_BYTES) {
              setProgress(key, { state: "error", message: oversizeUploadMessage("photo", blob.size) });
              continue;
            }
          } else {
            if (file.size > VIDEO_DB_CAP_BYTES) {
              setProgress(key, { state: "error", message: oversizeUploadMessage("video", file.size) });
              continue;
            }
            const probe = await probeVideo(file);
            width = probe.width;
            height = probe.height;
            durationSeconds = probe.durationSeconds;
            thumbnailBase64 = probe.thumbnailBase64;
          }

          const buffer = await blob.arrayBuffer();
          const sha256 = await sha256Hex(buffer);

          const created = await postAction({
            action: "create-item",
            contentType,
            byteSize: blob.size,
            sha256,
            title: defaultTitle(file.name),
            albumId,
            takenAt: file.lastModified ? new Date(file.lastModified).toISOString() : null,
            width,
            height,
            durationSeconds,
            thumbnailBase64,
          });
          if (!created) {
            setProgress(key, { state: "error", message: "Could not register the upload." });
            continue;
          }
          if (created.duplicate) {
            setProgress(key, { state: "duplicate", message: "Already in the library (same checksum)." });
            continue;
          }

          setProgress(key, { state: "uploading" });
          const put = await fetch(String(created.uploadUrl), { method: "PUT", body: blob });
          if (!put.ok) {
            const payload = (await put.json().catch(() => ({}))) as { error?: string };
            setProgress(key, { state: "error", message: payload.error ?? "Upload failed." });
            continue;
          }
          setProgress(key, { state: "done" });
        } catch (error) {
          setProgress(key, {
            state: "error",
            message: error instanceof Error ? error.message : "Upload failed.",
          });
        }
      }
      await refresh();
    },
    [live, filter.albumId, postAction, refresh, setProgress],
  );

  const createAlbum = useCallback(async () => {
    const name = albumName.trim();
    if (!name) return;
    const result = await postAction({
      action: "create-album",
      name,
      eventKey: albumEvent.trim() || null,
    });
    if (result) {
      setAlbumFormOpen(false);
      setAlbumName("");
      setAlbumEvent("");
      await refresh();
    }
  }, [albumName, albumEvent, postAction, refresh]);

  const deleteSelected = useCallback(async () => {
    if (!selected || selected.origin !== "library") return;
    if (!window.confirm(`Delete "${selected.title}" permanently?`)) return;
    const result = await postAction({ action: "delete-item", itemId: selected.id });
    if (result) {
      setSelectedId(null);
      await refresh();
    }
  }, [selected, postAction, refresh]);

  const saveDetail = useCallback(
    async (patch: { caption?: string | null; subteam?: string | null; eventKey?: string | null; albumId?: string | null }) => {
      if (!selected || selected.origin !== "library") return;
      const result = await postAction({ action: "update-item", itemId: selected.id, ...patch });
      if (result) await refresh();
    },
    [selected, postAction, refresh],
  );

  if (loadError) {
    return (
      <div className="ml-page">
        <PageHeader title="Media Library" description="Team photos and videos, in one place." />
        <ErrorState message={loadError} onRetry={() => void refresh()} />
      </div>
    );
  }
  if (!view) {
    return (
      <div className="ml-page">
        <PageHeader title="Media Library" description="Team photos and videos, in one place." />
        <SoftBlockSkeleton />
      </div>
    );
  }
  if (view.status === "setup_required") {
    return (
      <div className="ml-page">
        <PageHeader title="Media Library" description="Team photos and videos, in one place." />
        <EmptyState title="Pick a team first" description={view.message}>
          {view.steps[0] ? (
            <Button as="a" variant="primary" href={view.steps[0].href}>
              {view.steps[0].label}
            </Button>
          ) : null}
        </EmptyState>
      </div>
    );
  }
  if (!live) return null;

  return (
    <div className="ml-page">
      <PageHeader
        title="Media Library"
        description="Every team photo and video — uploads, pit-scouting shots, and business artwork — in one place."
      />

      <Panel className="ml-meter" aria-label="Storage meter">
        <strong>{live.meter.headline}</strong>
        <span className="app-muted">{live.meter.hint}</span>
        <span className="app-muted ml-meter-note">
          Photos are downscaled in your browser (~{formatMediaBytes(PHOTO_DB_CAP_BYTES)} cap). Videos up to{" "}
          {formatMediaBytes(VIDEO_DB_CAP_BYTES)} store in the database; bigger match footage belongs on a
          storage node or as a YouTube link in the <a href="/match-video-index">Match Video Index</a>.
        </span>
      </Panel>

      <div className="ml-toolbar" role="toolbar" aria-label="Media actions">
        <Button variant="primary" type="button" onClick={() => fileInputRef.current?.click()}>
          Add photos or videos
        </Button>
        <Button variant="secondary" type="button" onClick={() => cameraInputRef.current?.click()}>
          Take a photo
        </Button>
        <Button variant="secondary" type="button" onClick={() => setAlbumFormOpen((open) => !open)}>
          New album
        </Button>
        <input
          ref={fileInputRef}
          className="ml-hidden-input"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
          onChange={(event) => {
            void uploadFiles(event.target.files);
            event.target.value = "";
          }}
        />
        <input
          ref={cameraInputRef}
          className="ml-hidden-input"
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(event) => {
            void uploadFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      {albumFormOpen ? (
        <Panel className="ml-album-form" aria-label="New album">
          <label>
            Album name
            <input
              type="text"
              value={albumName}
              maxLength={120}
              onChange={(event) => setAlbumName(event.target.value)}
              placeholder="2026 Build Season"
            />
          </label>
          <label>
            Event key (optional)
            <input
              type="text"
              value={albumEvent}
              maxLength={40}
              onChange={(event) => setAlbumEvent(event.target.value)}
              placeholder="2026onosh"
            />
          </label>
          <Button variant="primary" type="button" disabled={!albumName.trim()} onClick={() => void createAlbum()}>
            Create album
          </Button>
        </Panel>
      ) : null}

      {actionError ? <p className="ml-error" role="alert">{actionError}</p> : null}

      {uploads.length ? (
        <Panel className="ml-uploads" aria-label="Uploads">
          <ul>
            {uploads.map((upload) => (
              <li key={upload.key} className={`ml-upload-${upload.state}`}>
                <strong>{upload.name}</strong>
                <span>
                  {upload.state === "preparing" && "Preparing…"}
                  {upload.state === "uploading" && "Uploading…"}
                  {upload.state === "done" && "Uploaded"}
                  {upload.state === "duplicate" && (upload.message ?? "Duplicate")}
                  {upload.state === "error" && (upload.message ?? "Failed")}
                </span>
              </li>
            ))}
          </ul>
          <Button variant="secondary" type="button" onClick={() => setUploads([])}>
            Clear
          </Button>
        </Panel>
      ) : null}

      <section className="ml-albums" aria-label="Albums">
        <button
          type="button"
          className={`ml-album-card${filter.albumId === "all" ? " active" : ""}`}
          onClick={() => setFilter((f) => ({ ...f, albumId: "all" }))}
        >
          <strong>All media</strong>
          <span className="app-muted">{live.items.length} items</span>
        </button>
        <button
          type="button"
          className={`ml-album-card${filter.albumId === NO_ALBUM ? " active" : ""}`}
          onClick={() => setFilter((f) => ({ ...f, albumId: NO_ALBUM }))}
        >
          <strong>Unfiled</strong>
          <span className="app-muted">library uploads without an album</span>
        </button>
        {live.albums.map((album) => (
          <button
            key={album.id}
            type="button"
            className={`ml-album-card${filter.albumId === album.id ? " active" : ""}`}
            onClick={() => setFilter((f) => ({ ...f, albumId: album.id }))}
          >
            <strong>{album.name}</strong>
            <span className="app-muted">
              {perAlbum.get(album.id) ?? 0} items
              {album.eventKey ? ` · ${album.eventKey}` : ""}
            </span>
          </button>
        ))}
      </section>

      <div className="ml-filters" role="group" aria-label="Filters">
        <label>
          Kind
          <select
            value={filter.kind}
            onChange={(event) => setFilter((f) => ({ ...f, kind: event.target.value as MediaKind | "all" }))}
          >
            <option value="all">All</option>
            {options.hasPhotos ? <option value="photo">Photos</option> : null}
            {options.hasVideos ? <option value="video">Videos</option> : null}
          </select>
        </label>
        <label>
          Event
          <select
            value={filter.eventKey}
            onChange={(event) => setFilter((f) => ({ ...f, eventKey: event.target.value }))}
          >
            <option value="all">All</option>
            {options.eventKeys.map((key) => (
              <option key={key} value={key}>{key}</option>
            ))}
          </select>
        </label>
        <label>
          Subteam
          <select
            value={filter.subteam}
            onChange={(event) => setFilter((f) => ({ ...f, subteam: event.target.value }))}
          >
            <option value="all">All</option>
            {options.subteams.map((tag) => (
              <option key={tag} value={tag}>{tag}</option>
            ))}
          </select>
        </label>
        <label>
          Source
          <select
            value={filter.origin}
            onChange={(event) => setFilter((f) => ({ ...f, origin: event.target.value as MediaOrigin | "all" }))}
          >
            <option value="all">All</option>
            {options.origins.map((origin) => (
              <option key={origin} value={origin}>{originLabel(origin)}</option>
            ))}
          </select>
        </label>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No media here yet"
          description={
            live.items.length === 0
              ? "Upload your first photos or videos — pit-scouting photos and business artwork will also appear here automatically once they exist."
              : "Nothing matches the current filters."
          }
        />
      ) : (
        <ul className="ml-grid" aria-label="Media items">
          {filtered.map((item) => (
            <li key={item.id}>
              <button type="button" className="ml-item" onClick={() => setSelectedId(item.id)}>
                <span className="ml-thumb">
                  {item.thumbnailSrc || (item.kind === "photo" && item.status === "ready") ? (
                    <img
                      src={item.thumbnailSrc ?? item.src}
                      alt={item.title}
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <span className="ml-thumb-fallback" aria-hidden="true">
                      {item.kind === "video" ? "▶" : "▣"}
                    </span>
                  )}
                  {item.kind === "video" && item.durationSeconds ? (
                    <span className="ml-duration">{formatDuration(item.durationSeconds)}</span>
                  ) : null}
                  {item.status === "pending" ? <span className="ml-pending">upload incomplete</span> : null}
                </span>
                <span className="ml-item-title">{item.title}</span>
                <span className="ml-item-meta app-muted">
                  {originLabel(item.origin)} · {formatMediaBytes(item.byteSize)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected ? (
        <DetailOverlay
          item={selected}
          albums={live.albums}
          onClose={() => setSelectedId(null)}
          onDelete={() => void deleteSelected()}
          onSave={(patch) => void saveDetail(patch)}
        />
      ) : null}
    </div>
  );
}

function DetailOverlay({
  item,
  albums,
  onClose,
  onDelete,
  onSave,
}: {
  item: MediaLibraryItem;
  albums: LiveView["albums"];
  onClose: () => void;
  onDelete: () => void;
  onSave: (patch: {
    caption?: string | null;
    subteam?: string | null;
    eventKey?: string | null;
    albumId?: string | null;
  }) => void;
}) {
  const [caption, setCaption] = useState(item.caption ?? "");
  const [subteam, setSubteam] = useState(item.subteam ?? "");
  const [eventKey, setEventKey] = useState(item.eventKey ?? "");
  const [albumId, setAlbumId] = useState(item.albumId ?? "");
  const editable = item.origin === "library" && item.canManage;

  return (
    <div className="ml-overlay" role="dialog" aria-modal="true" aria-label={item.title}>
      <div className="ml-detail app-card">
        <header className="ml-detail-head">
          <h2>{item.title}</h2>
          <Button variant="secondary" type="button" onClick={onClose}>
            Close
          </Button>
        </header>

        <div className="ml-detail-media">
          {item.kind === "video" ? (
            <video controls preload="metadata" src={item.src} poster={item.thumbnailSrc ?? undefined} />
          ) : (
            <img src={item.src} alt={item.title} />
          )}
        </div>

        <p className="app-muted ml-detail-meta">
          {originLabel(item.origin)} · {formatMediaBytes(item.byteSize)}
          {item.width && item.height ? ` · ${item.width}×${item.height}` : ""}
          {item.durationSeconds ? ` · ${formatDuration(item.durationSeconds)}` : ""}
          {item.uploaderName ? ` · by ${item.uploaderName}` : ""}
          {item.storageLocation === "node" ? " · stored on team storage node" : ""}
        </p>

        {editable ? (
          <div className="ml-detail-form">
            <label>
              Caption
              <textarea
                value={caption}
                maxLength={2000}
                rows={2}
                onChange={(event) => setCaption(event.target.value)}
              />
            </label>
            <div className="ml-detail-row">
              <label>
                Subteam
                <input type="text" value={subteam} maxLength={60} onChange={(e) => setSubteam(e.target.value)} />
              </label>
              <label>
                Event key
                <input type="text" value={eventKey} maxLength={40} onChange={(e) => setEventKey(e.target.value)} />
              </label>
              <label>
                Album
                <select value={albumId} onChange={(e) => setAlbumId(e.target.value)}>
                  <option value="">No album</option>
                  {albums.map((album) => (
                    <option key={album.id} value={album.id}>{album.name}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="ml-detail-actions">
              <Button variant="primary" type="button" onClick={() => onSave({ caption: caption.trim() || null, subteam: subteam.trim() || null, eventKey: eventKey.trim() || null, albumId: albumId || null, }) }>
                Save details
              </Button>
              <Button as="a" variant="secondary" href={item.src} download={item.title}>
                Download
              </Button>
              <Button variant="danger" type="button" onClick={onDelete}>
                Delete
              </Button>
            </div>
          </div>
        ) : (
          <div className="ml-detail-actions">
            {item.caption ? <p>{item.caption}</p> : null}
            <Button as="a" variant="secondary" href={item.src} download={item.title}>
              Download
            </Button>
            {item.origin !== "library" ? (
              <span className="app-muted">
                Managed in {item.origin === "pit_scouting" ? "Scouting" : "Business"} — shown here read-only.
              </span>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
