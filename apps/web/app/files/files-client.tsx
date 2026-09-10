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
} from "react";
import { PageHeader, Panel, Button } from "../../components/ui";
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
import type { DriveFile, DriveSharedWithMe } from "../../lib/drive/types";
import { FILES_RELATED_INCLUDE, filesRelatedLinks } from "../../lib/drive/files-related";
import { uploadOneFile, type UploadItem } from "./upload-queue";
import {
  RAILS,
  railScope,
  type Listing,
  type Rail,
  type ShareDialogState,
} from "./files-model";
import { Body, PreviewPane, ShareDialog, UploadList } from "./files-panels";
import { ScopeNotice } from "./files-scope-notice";

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

  const related = (
    <nav className="product-hub-related" aria-label="Related files tools">
      {filesRelatedLinks(activeOrgId, { include: [...FILES_RELATED_INCLUDE] }).map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
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
      {related}
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
