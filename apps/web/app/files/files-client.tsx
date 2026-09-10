"use client";

/**
 * Vantage Drive — the file space.
 *
 * Design intent, so a later editor knows what to preserve: this page has to be
 * BETTER than the Google Drive folder a team is leaving behind, not merely a
 * copy of it. What makes it better is that it tells the truth about three
 * things Drive hides: where each file's bytes actually go, who can see it, and
 * what a share link really does. Those three sentences are on screen, not in a
 * help article.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import { EmptyState, PageHeader, Panel, Button } from "../../components/ui";
import { OfflineBanner } from "../../components/offline-banner";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { fetchActiveOrgId, readOrgIdFromSearch } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import {
  FILE_BYTES_CAP_LABEL,
  driveFileOfflineKey,
  dropOfflineFile,
  formatOfflineUsage,
  keepOfflineFile,
  listOfflineFiles,
} from "../../lib/offline/file-bytes";
import {
  drivePreviewKind,
  formatDriveBytes,
  parseShareEmails,
} from "../../lib/drive/validation";
import type {
  DriveFile,
  DriveFolder,
  DriveScope,
  DriveShare,
  DriveSharedWithMe,
  DriveVirtualFolder,
} from "../../lib/drive/types";
import { uploadOneFile, type UploadItem } from "./upload-queue";

type Rail = "my" | "team" | "shared" | "recent" | "trash";

type Listing =
  | { status: "loading" }
  | { status: "error"; message: string; detail: string }
  | { status: "setup_required"; reason: string }
  | {
      status: "ready";
      orgId: string;
      orgName: string;
      scope: DriveScope;
      folderId: string | null;
      breadcrumbs: Array<{ id: string | null; name: string }>;
      folders: DriveFolder[];
      files: DriveFile[];
      virtualFolders: DriveVirtualFolder[];
      usage: { dbBytes: number; nodeBytes: number; objectBytes: number; fileCount: number };
      viewer: { userId: string; email: string; role: string };
    }
  | { status: "shared"; orgId: string; orgName: string; shares: DriveSharedWithMe[] }
  | { status: "list"; orgId: string; orgName: string; files: DriveFile[]; rail: Rail };

const RAILS: Array<{ id: Rail; label: string; hint: string }> = [
  { id: "my", label: "My files", hint: "Yours alone. Nobody else on the team can open these." },
  { id: "team", label: "Team files", hint: "Everyone on the team can open these." },
  { id: "shared", label: "Shared with me", hint: "Files other people sent to your email address." },
  { id: "recent", label: "Recent", hint: "The newest files you can see." },
  { id: "trash", label: "Bin", hint: "Deleted files, still restorable." },
];

function railScope(rail: Rail): DriveScope {
  return rail === "my" ? "personal" : "team";
}

function fileIcon(file: { contentClass: string; contentType: string }): string {
  if (file.contentClass === "video") return "▶";
  if (file.contentClass === "photo") return "▣";
  if (file.contentClass === "cad") return "◈";
  if (file.contentClass === "archive") return "▥";
  if (file.contentType === "application/pdf") return "▤";
  return "▢";
}

function storageLabel(file: DriveFile): string {
  if (file.storageLocation === "node") return "On your storage node";
  if (file.storageLocation === "object") return "In object storage";
  return "In Vantage";
}

function formatWhen(value: string | null): string {
  if (!value) return "—";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * The paragraph that makes this product trustworthy enough for a team of
 * minors. It is at the top of the page, not in a settings screen, because the
 * person who needs to read it is the fifteen-year-old deciding where to put
 * something.
 */
function ScopeNotice() {
  return (
    <Panel className="drive-scope-notice">
      <h2>Who can see what</h2>
      <p>
        <strong>My files is yours.</strong> Nobody else on the team can open it — not other students,
        not mentors, not the team owner. That cannot be turned off. The only way something leaves
        your space is a share you create yourself.
      </p>
      <p>
        <strong>Team files belong to the team.</strong> Every member can open them. Owners and admins
        can also see every share link anyone has created on team files, so a link that leaves the team
        is never invisible to the people responsible for it — but they still cannot see inside
        anyone&rsquo;s personal space.
      </p>
      <p>
        <strong>A share link works without a Vantage account.</strong> Anyone holding the link can open
        what it points at, until it expires or you revoke it. Treat it like a key, not like a name on
        a list.
      </p>
    </Panel>
  );
}

type ShareDialogState = {
  target: { kind: "file" | "folder"; id: string; name: string };
} | null;

export default function FilesClient() {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [rail, setRail] = useState<Rail>("team");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [listing, setListing] = useState<Listing>({ status: "loading" });
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<DriveFile | null>(null);
  const [shareDialog, setShareDialog] = useState<ShareDialogState>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [offlineKeys, setOfflineKeys] = useState<Set<string>>(() => new Set());
  const [offlineBytes, setOfflineBytes] = useState(0);
  const fileInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fromUrl = readOrgIdFromSearch(window.location.search);
    if (fromUrl) {
      setOrgId(fromUrl);
      return;
    }
    void fetchActiveOrgId().then((id) => {
      if (!cancelled) setOrgId(id);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (orgId) params.set("orgId", orgId);
    if (rail === "shared") params.set("view", "shared");
    else if (rail === "recent") params.set("view", "recent");
    else if (rail === "trash") params.set("view", "trash");
    else {
      params.set("scope", railScope(rail));
      if (folderId) params.set("folderId", folderId);
    }
    const variant = `${rail}:${folderId ?? ""}`;
    const applyListing = (payload: Listing, cached: boolean, at: string | null) => {
      setListing(payload);
      setFromCache(cached);
      setCachedAt(at);
    };
    try {
      const response = await fetch(`/api/drive?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        if (orgId) {
          const row = await getFeatureSnapshot<Listing>("files", orgId, variant);
          if (row) {
            applyListing(row.data, true, row.cachedAt);
            return;
          }
        }
        setListing({
          status: "error",
          message: body.error ?? `Could not load your files (HTTP ${response.status}).`,
          detail: "",
        });
        return;
      }
      const payload = (await response.json()) as
        | { status: "setup_required"; reason: string }
        | { status: "ready"; [key: string]: unknown }
        | { status: "shared"; orgId: string; orgName: string; shares: DriveSharedWithMe[] }
        | { status: "recent" | "trash"; orgId: string; orgName: string; files: DriveFile[] };

      if (payload.status === "setup_required") {
        applyListing({ status: "setup_required", reason: payload.reason }, false, null);
        return;
      }
      if (payload.status === "shared") {
        const next: Listing = {
          status: "shared",
          orgId: payload.orgId,
          orgName: payload.orgName,
          shares: payload.shares,
        };
        applyListing(next, false, new Date().toISOString());
        await putFeatureSnapshot("files", payload.orgId, next, variant);
        return;
      }
      if (payload.status === "recent" || payload.status === "trash") {
        const next: Listing = {
          status: "list",
          orgId: payload.orgId,
          orgName: payload.orgName,
          files: payload.files,
          rail,
        };
        applyListing(next, false, new Date().toISOString());
        await putFeatureSnapshot("files", payload.orgId, next, variant);
        return;
      }
      const ready = payload as unknown as Listing;
      applyListing(ready, false, new Date().toISOString());
      if (!orgId && typeof (payload as { orgId?: string }).orgId === "string") {
        setOrgId((payload as { orgId: string }).orgId);
      }
      const persistOrg = orgId ?? (typeof (payload as { orgId?: string }).orgId === "string" ? (payload as { orgId: string }).orgId : null);
      if (persistOrg) await putFeatureSnapshot("files", persistOrg, ready, variant);
    } catch (error) {
      if (orgId) {
        const row = await getFeatureSnapshot<Listing>("files", orgId, variant);
        if (row) {
          applyListing(row.data, true, row.cachedAt);
          return;
        }
      }
      const copy = loadFailureCopy(
        classifyLoadFailure({ message: error instanceof Error ? error.message : String(error) }),
      );
      setListing({ status: "error", message: copy.title, detail: copy.description });
    }
  }, [orgId, rail, folderId]);

  useEffect(() => {
    setListing({ status: "loading" });
    void load();
  }, [load]);

  const activeOrgId = useMemo(() => {
    if (orgId) return orgId;
    if (listing.status === "ready" || listing.status === "shared" || listing.status === "list") {
      return listing.orgId;
    }
    return null;
  }, [orgId, listing]);

  const refreshOffline = useCallback(async () => {
    if (!activeOrgId) return;
    const rows = await listOfflineFiles(activeOrgId);
    setOfflineKeys(new Set(rows.map((row) => row.key)));
    setOfflineBytes(rows.reduce((sum, row) => sum + row.byteSize, 0));
  }, [activeOrgId]);

  useEffect(() => {
    void refreshOffline();
  }, [refreshOffline, listing]);

  const toggleOffline = useCallback(
    async (file: DriveFile) => {
      if (!activeOrgId) return;
      const key = driveFileOfflineKey(activeOrgId, file.id);
      if (offlineKeys.has(key)) {
        await dropOfflineFile(key);
        setNotice(`${file.name} is no longer kept on this device.`);
      } else {
        const result = await keepOfflineFile({
          key,
          orgId: activeOrgId,
          name: file.name,
          url: `/api/drive/files/${file.id}/content?orgId=${encodeURIComponent(activeOrgId)}&download=1`,
          contentType: file.contentType,
          expectedBytes: file.byteSize,
        });
        if (!result.ok) {
          setNotice(result.reason);
          return;
        }
        setNotice(`${file.name} is available on this device even without signal.`);
      }
      await refreshOffline();
    },
    [activeOrgId, offlineKeys, refreshOffline],
  );

  const canUpload = rail === "my" || rail === "team";

  const startUploads = useCallback(
    (files: File[]) => {
      if (!activeOrgId || !canUpload || files.length === 0) return;
      const target = { orgId: activeOrgId, scope: railScope(rail), folderId };
      const queued: UploadItem[] = files.map((file, index) => ({
        id: `${Date.now()}-${index}-${file.name}`,
        name: file.name,
        byteSize: file.size,
        phase: "hashing",
        progress: 0,
        routeLabel: "Working out where this goes…",
        reason: "",
        error: null,
        fileId: null,
      }));
      setUploads((current) => [...queued, ...current]);

      void (async () => {
        // Sequential on purpose: parallel uploads of four 500 MB videos over a
        // school Wi-Fi make all four slower and none of them finish.
        for (let index = 0; index < files.length; index += 1) {
          const item = queued[index]!;
          await uploadOneFile(files[index]!, target, item, (patch) => {
            setUploads((current) =>
              current.map((entry) => (entry.id === item.id ? { ...entry, ...patch } : entry)),
            );
          });
        }
        await load();
      })();
    },
    [activeOrgId, canUpload, rail, folderId, load],
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragging(false);
      startUploads(Array.from(event.dataTransfer.files ?? []));
    },
    [startUploads],
  );

  const act = useCallback(
    async (input: RequestInfo, init: RequestInit, successNotice?: string) => {
      try {
        const response = await fetch(input, init);
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          setNotice(body.error ?? `That did not work (HTTP ${response.status}).`);
          return false;
        }
        if (successNotice) setNotice(successNotice);
        await load();
        return true;
      } catch {
        setNotice("Could not reach Vantage. Check your connection and try again.");
        return false;
      }
    },
    [load],
  );

  // ---- render -------------------------------------------------------------

  const header = (
    <PageHeader
      navPath="/files"
      title="Files"
      description="One place for the team's videos, CAD exports, print files, flyers and paperwork — and a private space of your own. Share anything to any email address, account or not."
    >
      <div className="drive-header-actions">
        <div className="drive-layout-toggle" role="group" aria-label="Layout">
          <button
            type="button"
            className={`app-button ${layout === "grid" ? "" : "secondary"}`}
            aria-pressed={layout === "grid"}
            onClick={() => setLayout("grid")}
          >
            Grid
          </button>
          <button
            type="button"
            className={`app-button ${layout === "list" ? "" : "secondary"}`}
            aria-pressed={layout === "list"}
            onClick={() => setLayout("list")}
          >
            List
          </button>
        </div>
        {canUpload ? (
          <Button variant="primary" type="button" onClick={() => fileInput.current?.click()}>
            Upload files
          </Button>
        ) : null}
      </div>
    </PageHeader>
  );

  const rails = (
    <nav className="drive-rail" aria-label="File spaces">
      {RAILS.map((entry) => (
        <button
          key={entry.id}
          type="button"
          className={`drive-rail-item ${rail === entry.id ? "active" : ""}`}
          aria-current={rail === entry.id ? "page" : undefined}
          onClick={() => {
            setRail(entry.id);
            setFolderId(null);
            setPreview(null);
          }}
        >
          <strong>{entry.label}</strong>
          <span>{entry.hint}</span>
        </button>
      ))}
    </nav>
  );

  return (
    <main className="app-page drive-page">
      {header}
      <OfflineBanner feature="Files" fromCache={fromCache} cachedAt={cachedAt} />
      {activeOrgId && offlineBytes > 0 ? (
        <p className="app-muted drive-offline-usage">
          {formatOfflineUsage(offlineBytes)} of files kept on this device ({FILE_BYTES_CAP_LABEL} max).
        </p>
      ) : null}
      <ScopeNotice />

      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          startUploads(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />

      {notice ? (
        <Panel className="drive-notice" role="status">
          <p>{notice}</p>
          <Button variant="secondary" type="button" onClick={() => setNotice(null)}>
            Dismiss
          </Button>
        </Panel>
      ) : null}

      <div className="drive-layout">
        {rails}

        <div
          className={`drive-main ${dragging ? "dragging" : ""}`}
          onDragOver={(event) => {
            if (!canUpload) return;
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          {canUpload && dragging ? (
            <div className="drive-drop-hint">Drop to upload into {rail === "my" ? "My files" : "Team files"}</div>
          ) : null}

          <UploadList uploads={uploads} onClear={() => setUploads([])} />

          <Body
            listing={listing}
            rail={rail}
            layout={layout}
            orgId={activeOrgId}
            onOpenFolder={(id) => {
              setFolderId(id);
              setPreview(null);
            }}
            onPreview={setPreview}
            onShare={(target) => setShareDialog({ target })}
            onCreateFolder={async (name) => {
              if (!activeOrgId) return;
              await act(
                "/api/drive/folders",
                {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    orgId: activeOrgId,
                    scope: railScope(rail),
                    parentId: folderId,
                    name,
                  }),
                },
                `Created "${name}".`,
              );
            }}
            onRenameFile={async (file, name) => {
              if (!activeOrgId) return;
              await act(
                "/api/drive/files",
                {
                  method: "PATCH",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ orgId: activeOrgId, fileId: file.id, action: "rename", name }),
                },
                `Renamed to "${name}".`,
              );
            }}
            onDeleteFile={async (file) => {
              if (!activeOrgId) return;
              await act(
                `/api/drive/files?orgId=${encodeURIComponent(activeOrgId)}&fileId=${file.id}`,
                { method: "DELETE" },
                `"${file.name}" is in the bin. You can restore it from there.`,
              );
            }}
            onRestoreFile={async (file) => {
              if (!activeOrgId) return;
              await act(
                "/api/drive/files",
                {
                  method: "PATCH",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ orgId: activeOrgId, fileId: file.id, action: "restore" }),
                },
                `Restored "${file.name}".`,
              );
            }}
            offlineKeys={offlineKeys}
            onToggleOffline={toggleOffline}
            onDeleteFolder={async (folder) => {
              if (!activeOrgId) return;
              await act(
                `/api/drive/folders?orgId=${encodeURIComponent(activeOrgId)}&folderId=${folder.id}`,
                { method: "DELETE" },
                `Deleted "${folder.name}".`,
              );
            }}
          />
        </div>
      </div>

      {preview && activeOrgId ? (
        <PreviewPane file={preview} orgId={activeOrgId} onClose={() => setPreview(null)} />
      ) : null}

      {shareDialog && activeOrgId ? (
        <ShareDialog
          orgId={activeOrgId}
          target={shareDialog.target}
          onClose={() => {
            setShareDialog(null);
            void load();
          }}
        />
      ) : null}
    </main>
  );
}

// ---------------------------------------------------------------------------

function UploadList({ uploads, onClear }: { uploads: UploadItem[]; onClear: () => void }) {
  if (uploads.length === 0) return null;
  const active = uploads.filter((entry) => entry.phase !== "done" && entry.phase !== "failed").length;
  return (
    <Panel className="drive-uploads" aria-label="Uploads">
      <header>
        <h2>
          Uploads {active > 0 ? <span className="app-muted">({active} in progress)</span> : null}
        </h2>
        {active === 0 ? (
          <Button variant="secondary" type="button" onClick={onClear}>
            Clear
          </Button>
        ) : null}
      </header>
      <ul>
        {uploads.map((entry) => (
          <li key={entry.id} className={`drive-upload ${entry.phase}`}>
            <div className="drive-upload-line">
              <strong>{entry.name}</strong>
              <span className="app-muted">{formatDriveBytes(entry.byteSize)}</span>
            </div>
            <div className="drive-upload-line">
              <span className="drive-route">{entry.routeLabel}</span>
              <span className="app-muted">
                {entry.phase === "hashing"
                  ? "Checksumming"
                  : entry.phase === "routing"
                    ? "Deciding where it goes"
                    : entry.phase === "sending"
                      ? `${Math.round(entry.progress * 100)}%`
                      : entry.phase === "finishing"
                        ? "Finishing"
                        : entry.phase === "done"
                          ? "Done"
                          : "Failed"}
              </span>
            </div>
            {entry.phase !== "failed" ? (
              <progress value={entry.progress} max={1} />
            ) : (
              <p className="drive-upload-error">{entry.error}</p>
            )}
            {entry.reason && entry.phase !== "failed" ? (
              <p className="app-muted drive-upload-reason">{entry.reason}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

type BodyProps = {
  listing: Listing;
  rail: Rail;
  layout: "grid" | "list";
  orgId: string | null;
  onOpenFolder: (id: string | null) => void;
  onPreview: (file: DriveFile) => void;
  onShare: (target: { kind: "file" | "folder"; id: string; name: string }) => void;
  onCreateFolder: (name: string) => Promise<void>;
  onRenameFile: (file: DriveFile, name: string) => Promise<void>;
  onDeleteFile: (file: DriveFile) => Promise<void>;
  onRestoreFile: (file: DriveFile) => Promise<void>;
  onDeleteFolder: (folder: DriveFolder) => Promise<void>;
  offlineKeys: Set<string>;
  onToggleOffline: (file: DriveFile) => Promise<void>;
};

function Body(props: BodyProps) {
  const { listing, rail, layout, orgId } = props;

  if (listing.status === "loading") {
    return <EmptyState title="Loading your files…" aria-busy soft />;
  }
  if (listing.status === "setup_required") {
    return (
      <EmptyState badge="Setup" badgeTone="setup" title="Files needs a database" description={listing.reason} />
    );
  }
  if (listing.status === "error") {
    return <EmptyState title={listing.message} description={listing.detail} />;
  }

  if (listing.status === "shared") {
    if (listing.shares.length === 0) {
      return (
        <EmptyState
          title="Nothing has been shared with you yet"
          description={`When someone shares a file or folder with ${"your email address"}, it appears here. Shares sent to an address you have not signed in with will only arrive by email.`}
          soft
        />
      );
    }
    return (
      <Panel>
        <h2>Shared with me</h2>
        <ul className="drive-shared-list">
          {listing.shares.map((share) => (
            <li key={share.shareId}>
              <div>
                <strong>{share.target.name}</strong>
                <span className="app-muted">
                  {share.sharedByName ? `${share.sharedByName} · ` : ""}
                  {share.orgName} · {formatWhen(share.sharedAt)}
                  {share.expiresAt ? ` · expires ${formatWhen(share.expiresAt)}` : ""}
                </span>
                {share.note ? <p className="drive-share-note">{share.note}</p> : null}
              </div>
              <Button as="a" variant="secondary"
                href={`/api/drive/shared-with-me/${share.shareId}${
                  share.target.kind === "file"
                    ? `?fileId=${share.target.id}${share.canDownload ? "&download=1" : ""}`
                    : ""
                }`}
              >
                {share.target.kind === "file" ? (share.canDownload ? "Download" : "Open") : "See files"}
              </Button>
            </li>
          ))}
        </ul>
      </Panel>
    );
  }

  if (listing.status === "list") {
    if (listing.files.length === 0) {
      return (
        <EmptyState
          title={rail === "trash" ? "The bin is empty" : "Nothing here yet"}
          description={
            rail === "trash"
              ? "Deleted files land here and stay restorable."
              : "Upload something into My files or Team files and it will show up here."
          }
          soft
        />
      );
    }
    return (
      <FileGrid
        files={listing.files}
        layout={layout}
        orgId={orgId}
        rail={rail}
        onPreview={props.onPreview}
        onShare={props.onShare}
        onRename={props.onRenameFile}
        onDelete={props.onDeleteFile}
        onRestore={props.onRestoreFile}
        offlineKeys={props.offlineKeys}
        onToggleOffline={props.onToggleOffline}
      />
    );
  }

  // ready
  const empty =
    listing.folders.length === 0 && listing.files.length === 0 && listing.virtualFolders.length === 0;

  return (
    <>
      <div className="drive-toolbar">
        <nav className="drive-breadcrumbs" aria-label="Folder path">
          <button type="button" className="link-button" onClick={() => props.onOpenFolder(null)}>
            {rail === "my" ? "My files" : "Team files"}
          </button>
          {listing.breadcrumbs.map((crumb) => (
            <span key={crumb.id ?? "root"}>
              <span aria-hidden="true"> / </span>
              <button
                type="button"
                className="link-button"
                onClick={() => props.onOpenFolder(crumb.id)}
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </nav>
        <div className="drive-toolbar-actions">
          <NewFolderButton onCreate={props.onCreateFolder} />
          <span className="app-muted drive-usage">
            {listing.usage.fileCount} file{listing.usage.fileCount === 1 ? "" : "s"} ·{" "}
            {formatDriveBytes(listing.usage.dbBytes)} in Vantage
            {listing.usage.nodeBytes > 0 ? ` · ${formatDriveBytes(listing.usage.nodeBytes)} on your node` : ""}
            {listing.usage.objectBytes > 0
              ? ` · ${formatDriveBytes(listing.usage.objectBytes)} in object storage`
              : ""}
          </span>
        </div>
      </div>

      {listing.virtualFolders.map((folder) => (
        <Panel key={folder.id} className="drive-virtual">
          <header>
            <h2>{folder.name}</h2>
            <Button as="a" variant="secondary" href={folder.href}>
              Open {folder.name}
            </Button>
          </header>
          <p className="app-muted">{folder.description}</p>
          {folder.itemCount === 0 ? (
            <p className="app-muted">Nothing in there yet.</p>
          ) : (
            <>
              <p className="app-muted">
                {folder.itemCount} item{folder.itemCount === 1 ? "" : "s"}
                {folder.items.length < folder.itemCount ? `, newest ${folder.items.length} shown` : ""}
              </p>
              <ul className="drive-virtual-list">
                {folder.items.map((item) => (
                  <li key={item.id}>
                    <span>{item.name}</span>
                    <span className="app-muted">{formatDriveBytes(item.byteSize)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      ))}

      {empty ? (
        <EmptyState
          title={rail === "my" ? "Your space is empty" : "No team files yet"}
          description={
            rail === "my"
              ? "Drop a file here or use Upload files. Nothing you put here is visible to anyone else on the team."
              : "Drop a file here or use Upload files. Everyone on the team will be able to open it."
          }
          soft
        />
      ) : (
        <>
          {listing.folders.length > 0 ? (
            <div className={`drive-folders ${layout}`}>
              {listing.folders.map((folder) => (
                <div key={folder.id} className="drive-folder">
                  <button
                    type="button"
                    className="drive-folder-open"
                    onClick={() => props.onOpenFolder(folder.id)}
                  >
                    <span aria-hidden="true">▤</span>
                    <strong>{folder.name}</strong>
                    <span className="app-muted">
                      {folder.fileCount} file{folder.fileCount === 1 ? "" : "s"}
                    </span>
                  </button>
                  <div className="drive-folder-actions">
                    <button
                      type="button"
                      className="link-button"
                      onClick={() =>
                        props.onShare({ kind: "folder", id: folder.id, name: folder.name })
                      }
                    >
                      Share
                    </button>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => void props.onDeleteFolder(folder)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {listing.files.length > 0 ? (
            <FileGrid
              files={listing.files}
              layout={layout}
              orgId={orgId}
              rail={rail}
              onPreview={props.onPreview}
              onShare={props.onShare}
              onRename={props.onRenameFile}
              onDelete={props.onDeleteFile}
              onRestore={props.onRestoreFile}
              offlineKeys={props.offlineKeys}
              onToggleOffline={props.onToggleOffline}
            />
          ) : null}
        </>
      )}
    </>
  );
}

function NewFolderButton({ onCreate }: { onCreate: (name: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  if (!open) {
    return (
      <Button variant="secondary" type="button" onClick={() => setOpen(true)}>
        New folder
      </Button>
    );
  }
  return (
    <form
      className="drive-inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) return;
        void onCreate(name.trim()).then(() => {
          setName("");
          setOpen(false);
        });
      }}
    >
      <input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Folder name"
        aria-label="Folder name"
        maxLength={200}
      />
      <Button variant="primary" type="submit">
        Create
      </Button>
      <Button variant="secondary" type="button" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </form>
  );
}

type FileGridProps = {
  files: DriveFile[];
  layout: "grid" | "list";
  orgId: string | null;
  rail: Rail;
  onPreview: (file: DriveFile) => void;
  onShare: (target: { kind: "file" | "folder"; id: string; name: string }) => void;
  onRename: (file: DriveFile, name: string) => Promise<void>;
  onDelete: (file: DriveFile) => Promise<void>;
  onRestore: (file: DriveFile) => Promise<void>;
  offlineKeys: Set<string>;
  onToggleOffline: (file: DriveFile) => Promise<void>;
};

function FileGrid(props: FileGridProps) {
  const { files, layout, orgId, rail } = props;
  return (
    <div className={`drive-files ${layout}`}>
      {files.map((file) => {
        const contentHref = orgId
          ? `/api/drive/files/${file.id}/content?orgId=${encodeURIComponent(orgId)}&download=1`
          : "#";
        return (
          <article key={file.id} className={`drive-file ${file.status}`}>
            <button
              type="button"
              className="drive-file-open"
              onClick={() => props.onPreview(file)}
              disabled={file.status !== "ready"}
            >
              <span className="drive-file-thumb" aria-hidden="true">
                {file.hasThumb && orgId ? (
                   
                  <img
                    src={`/api/drive/files/${file.id}/thumb?orgId=${encodeURIComponent(orgId)}`}
                    alt=""
                    loading="lazy"
                  />
                ) : (
                  <span className="drive-file-icon">{fileIcon(file)}</span>
                )}
              </span>
              <strong title={file.name}>{file.name}</strong>
              <span className="app-muted">
                {formatDriveBytes(file.byteSize)} · {storageLabel(file)}
              </span>
              {file.status !== "ready" ? (
                <span className="drive-pending">
                  Upload never finished — the bytes are not here. Upload it again.
                </span>
              ) : null}
            </button>

            <div className="drive-file-meta app-muted">
              {file.uploaderName ?? "Someone"} · {formatWhen(file.createdAt)}
              {file.shareCount > 0 ? (
                <> · <span className="drive-shared-badge">shared ({file.shareCount})</span></>
              ) : null}
            </div>

            <div className="drive-file-actions">
              {file.status === "ready" ? (
                <a className="link-button" href={contentHref}>
                  Download
                </a>
              ) : null}
              {file.status === "ready" && orgId ? (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => void props.onToggleOffline(file)}
                >
                  {props.offlineKeys.has(driveFileOfflineKey(orgId, file.id))
                    ? "Remove from this device"
                    : "Keep on this device"}
                </button>
              ) : null}
              {rail === "trash" ? (
                file.canManage ? (
                  <button type="button" className="link-button" onClick={() => void props.onRestore(file)}>
                    Restore
                  </button>
                ) : null
              ) : (
                <>
                  {file.canManage && file.status === "ready" ? (
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => props.onShare({ kind: "file", id: file.id, name: file.name })}
                    >
                      Share
                    </button>
                  ) : null}
                  {file.canManage ? (
                    <RenameButton file={file} onRename={props.onRename} />
                  ) : null}
                  {file.canManage ? (
                    <button type="button" className="link-button" onClick={() => void props.onDelete(file)}>
                      Delete
                    </button>
                  ) : null}
                </>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function RenameButton({
  file,
  onRename,
}: {
  file: DriveFile;
  onRename: (file: DriveFile, name: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(file.name);
  if (!open) {
    return (
      <button type="button" className="link-button" onClick={() => setOpen(true)}>
        Rename
      </button>
    );
  }
  return (
    <form
      className="drive-inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) return;
        void onRename(file, name.trim()).then(() => setOpen(false));
      }}
    >
      <input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        aria-label="File name"
        maxLength={255}
      />
      <Button variant="primary" type="submit">
        Save
      </Button>
      <Button variant="secondary" type="button" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </form>
  );
}

function PreviewPane({
  file,
  orgId,
  onClose,
}: {
  file: DriveFile;
  orgId: string;
  onClose: () => void;
}) {
  const src = `/api/drive/files/${file.id}/content?orgId=${encodeURIComponent(orgId)}`;
  const kind = drivePreviewKind(file.contentType);
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (kind !== "text") return;
    let cancelled = false;
    void fetch(src)
      .then((response) => (response.ok ? response.text() : Promise.reject(new Error("read failed"))))
      .then((body) => {
        if (!cancelled) setText(body.slice(0, 200_000));
      })
      .catch(() => {
        if (!cancelled) setText(null);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, src]);

  let body: ReactNode;
  if (kind === "image") {
     
    body = <img src={src} alt={file.name} />;
  } else if (kind === "video") {
    // No transcoding anywhere in Vantage: this is the file exactly as it was
    // uploaded, so a codec the browser cannot play will say so rather than
    // being silently converted.
    body = <video src={src} controls preload="metadata" />;
  } else if (kind === "audio") {
    body = <audio src={src} controls preload="metadata" />;
  } else if (kind === "pdf") {
    body = <iframe src={src} title={file.name} />;
  } else if (kind === "text") {
    body = <pre>{text ?? "Loading…"}</pre>;
  } else {
    body = (
      <div className="drive-preview-none">
        <p>
          Vantage will not render a {file.contentType} file in the browser — an uploaded file rendered
          on this page could run as code against everyone on the team. Download it and open it in the
          program that made it.
        </p>
      </div>
    );
  }

  return (
    <div className="drive-preview" role="dialog" aria-modal="true" aria-label={file.name}>
      <div className="drive-preview-inner">
        <header>
          <div>
            <strong>{file.name}</strong>
            <span className="app-muted">
              {formatDriveBytes(file.byteSize)} · {file.contentType} · {storageLabel(file)}
            </span>
          </div>
          <div>
            <Button as="a" variant="secondary" href={`${src}&download=1`}>
              Download
            </Button>
            <Button variant="primary" type="button" onClick={onClose}>
              Close
            </Button>
          </div>
        </header>
        <div className="drive-preview-body">{body}</div>
      </div>
    </div>
  );
}

function ShareDialog({
  orgId,
  target,
  onClose,
}: {
  orgId: string;
  target: { kind: "file" | "folder"; id: string; name: string };
  onClose: () => void;
}) {
  const [shares, setShares] = useState<DriveShare[] | null>(null);
  const [emails, setEmails] = useState("");
  const [note, setNote] = useState("");
  const [canDownload, setCanDownload] = useState(true);
  const [expiresAt, setExpiresAt] = useState("");
  const [created, setCreated] = useState<Array<{ id: string; email: string | null; url: string }>>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const params = new URLSearchParams({ orgId });
    if (target.kind === "file") params.set("fileId", target.id);
    const response = await fetch(`/api/drive/shares?${params.toString()}`, { cache: "no-store" });
    if (!response.ok) {
      setShares([]);
      return;
    }
    const body = (await response.json()) as { shares: DriveShare[] };
    setShares(
      body.shares.filter((share) =>
        target.kind === "file" ? share.target.id === target.id : share.target.id === target.id,
      ),
    );
  }, [orgId, target]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const parsed = parseShareEmails(emails);

  return (
    <div className="drive-preview" role="dialog" aria-modal="true" aria-label={`Share ${target.name}`}>
      <div className="drive-preview-inner drive-share-dialog">
        <header>
          <div>
            <strong>Share &ldquo;{target.name}&rdquo;</strong>
            <span className="app-muted">
              Anyone holding the link can open this, account or not, until it expires or you revoke it.
            </span>
          </div>
          <Button variant="primary" type="button" onClick={onClose}>
            Close
          </Button>
        </header>

        <div className="drive-preview-body">
          <form
            className="drive-share-form"
            onSubmit={(event) => {
              event.preventDefault();
              setBusy(true);
              setMessage(null);
              void (async () => {
                try {
                  const response = await fetch("/api/drive/shares", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                      orgId,
                      ...(target.kind === "file" ? { fileId: target.id } : { folderId: target.id }),
                      emails,
                      note: note.trim() || null,
                      canDownload,
                      expiresAt: expiresAt || null,
                    }),
                  });
                  const body = (await response.json()) as {
                    error?: string;
                    shares?: Array<{ id: string; email: string | null; url: string }>;
                    email?: { status: string; reason?: string; sent: number; failed: string[] };
                    rejectedAddresses?: string[];
                  };
                  if (!response.ok) {
                    setMessage(body.error ?? `That did not work (HTTP ${response.status}).`);
                    return;
                  }
                  setCreated(body.shares ?? []);
                  const parts: string[] = [];
                  if (body.email?.status === "setup_required") parts.push(body.email.reason ?? "");
                  else if (body.email && body.email.sent > 0) {
                    parts.push(`Emailed ${body.email.sent} recipient${body.email.sent === 1 ? "" : "s"}.`);
                  }
                  if (body.email?.reason && body.email.status !== "setup_required") {
                    parts.push(body.email.reason);
                  }
                  if (body.rejectedAddresses?.length) {
                    parts.push(`Not a valid address, so skipped: ${body.rejectedAddresses.join(", ")}.`);
                  }
                  setMessage(parts.filter(Boolean).join(" ") || "Link created.");
                  setEmails("");
                  await reload();
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            <label>
              <span>Email addresses (optional, comma separated)</span>
              <input
                value={emails}
                onChange={(event) => setEmails(event.target.value)}
                placeholder="parent@example.com, sponsor@company.com"
              />
              <small className="app-muted">
                {emails.trim()
                  ? `${parsed.emails.length} address${parsed.emails.length === 1 ? "" : "es"}${
                      parsed.rejected.length ? `, ${parsed.rejected.length} not valid` : ""
                    }. Each gets its own link, so you can revoke one without breaking the rest.`
                  : "Leave this empty for a plain link you copy and paste yourself."}
              </small>
            </label>

            <label>
              <span>Note to include (optional)</span>
              <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} maxLength={2000} />
            </label>

            <div className="drive-share-options">
              <label className="drive-checkbox">
                <input
                  type="checkbox"
                  checked={canDownload}
                  onChange={(event) => setCanDownload(event.target.checked)}
                />
                <span>
                  Allow downloading
                  <small className="app-muted">
                    {" "}
                    — off means view only. Honest limit: a determined viewer can still capture what
                    their browser renders.
                  </small>
                </span>
              </label>
              <label>
                <span>Expires (optional)</span>
                <input
                  type="datetime-local"
                  value={expiresAt}
                  onChange={(event) => setExpiresAt(event.target.value)}
                />
              </label>
            </div>

            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? "Creating…" : emails.trim() ? "Create and send" : "Create link"}
            </Button>
          </form>

          {message ? <p className="drive-share-message">{message}</p> : null}

          {created.length > 0 ? (
            <section className="drive-share-created">
              <h3>Your links</h3>
              <p className="app-muted">
                Copy these now. Only a hash is stored, so Vantage genuinely cannot show them to you
                again — if you lose one, make a new share.
              </p>
              <ul>
                {created.map((entry) => (
                  <li key={entry.id}>
                    {entry.email ? <span className="app-muted">{entry.email}</span> : null}
                    <input readOnly value={entry.url} onFocus={(event) => event.target.select()} />
                    <Button variant="secondary" type="button" onClick={() => void navigator.clipboard?.writeText(entry.url)}>
                      Copy
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="drive-share-existing">
            <h3>Existing shares</h3>
            {shares === null ? (
              <p className="app-muted">Loading…</p>
            ) : shares.length === 0 ? (
              <p className="app-muted">Nothing has been shared yet.</p>
            ) : (
              <ul>
                {shares.map((share) => (
                  <li key={share.id}>
                    <div>
                      <strong>{share.email ?? "Anyone with the link"}</strong>
                      <span className="app-muted">
                        {share.canDownload ? "Can download" : "View only"} · created{" "}
                        {formatWhen(share.createdAt)}
                        {share.expiresAt ? ` · expires ${formatWhen(share.expiresAt)}` : ""}
                        {" · "}
                        {share.useCount > 0
                          ? `opened ${share.useCount} time${share.useCount === 1 ? "" : "s"}, last ${formatWhen(share.lastUsedAt)}`
                          : "never opened"}
                      </span>
                    </div>
                    <Button variant="secondary" type="button" onClick={() => void fetch( `/api/drive/shares?orgId=${encodeURIComponent(orgId)}&shareId=${share.id}`, { method: "DELETE" }, ).then(() => reload()) }>
                      Revoke
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
