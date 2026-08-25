"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  Panel,
  SoftBlockSkeleton,
} from "../../components/ui";
import {
  buildFolderTree,
  flattenFolderTree,
  folderPath,
  folderSubtreeIds,
  wouldCreateCycle,
} from "../../lib/library/folder-tree";
import {
  TYPE_LABELS,
  fileExtension,
  filterResources,
  folderResourceCounts,
} from "../../lib/library/library-filters";
import type {
  LibraryFolder,
  LibraryResource,
  LibraryResourceType,
  LibraryView,
  LibraryVisibility,
} from "../../lib/library/types";
import {
  LIBRARY_DB_CAP_BYTES,
  formatLibraryBytes,
  oversizeFileMessage,
  parseTagInput,
  sanitizeFileName,
  titleFromFileName,
} from "../../lib/library/validation";
import { describeAudience } from "../../lib/library/visibility";
import "./library.css";

type LiveView = Extract<LibraryView, { status: "live" }>;

type UploadProgress = {
  key: string;
  name: string;
  state: "preparing" | "uploading" | "done" | "duplicate" | "error";
  message?: string;
};

const TYPE_FILTERS: Array<LibraryResourceType | "all"> = [
  "all", "cad", "document", "image", "link", "archive", "code", "other",
];

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function cardGlyph(resource: LibraryResource): string {
  if (resource.kind === "link") return "LINK";
  const ext = fileExtension(resource.fileName);
  return ext ? `.${ext.toUpperCase()}` : "FILE";
}

// ---- sharing controls (shared by resource + folder overlays) ----

function SharingEditor({
  visibility,
  grantedUserIds,
  members,
  viewerId,
  onChange,
}: {
  visibility: LibraryVisibility;
  grantedUserIds: string[];
  members: LiveView["members"];
  viewerId: string;
  onChange: (visibility: LibraryVisibility, grantedUserIds: string[]) => void;
}) {
  const others = members.filter((member) => member.id !== viewerId);
  return (
    <div className="tl-sharing">
      <label>
        Who can see this
        <select
          value={visibility}
          onChange={(event) =>
            onChange(event.target.value === "restricted" ? "restricted" : "team", grantedUserIds)
          }
        >
          <option value="team">Everyone on the team</option>
          <option value="restricted">Only specific members</option>
        </select>
      </label>
      {visibility === "restricted" ? (
        others.length ? (
          <div className="tl-member-list" role="group" aria-label="Members with access">
            {others.map((member) => (
              <label key={member.id} className="tl-member">
                <input
                  type="checkbox"
                  checked={grantedUserIds.includes(member.id)}
                  onChange={(event) =>
                    onChange(
                      "restricted",
                      event.target.checked
                        ? [...grantedUserIds, member.id]
                        : grantedUserIds.filter((id) => id !== member.id),
                    )
                  }
                />
                <span>{member.name ?? "Unnamed member"}</span>
              </label>
            ))}
          </div>
        ) : (
          <p className="app-muted tl-sharing-note">
            No other members to pick yet — only you and team owners/admins will see it.
          </p>
        )
      ) : null}
      <p className="app-muted tl-sharing-note">
        You and team owners/admins can always see items you share.
      </p>
    </div>
  );
}

// ---- component ----

export default function LibraryClient() {
  const [view, setView] = useState<LibraryView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<LibraryResourceType | "all">("all");
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadProgress[]>([]);
  const [uploadVisibility, setUploadVisibility] = useState<LibraryVisibility>("team");
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editFolderId, setEditFolderId] = useState<string | null>(null);
  const [folderFormOpen, setFolderFormOpen] = useState(false);
  const [linkFormOpen, setLinkFormOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/library");
      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      setView((await response.json()) as LibraryView);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load the team library");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const live: LiveView | null = view?.status === "live" ? view : null;
  const folders = useMemo(() => live?.folders ?? [], [live]);
  const resources = useMemo(() => live?.resources ?? [], [live]);
  const membersById = useMemo(
    () => new Map((live?.members ?? []).map((member) => [member.id, member.name])),
    [live],
  );

  const tree = useMemo(() => buildFolderTree(folders), [folders]);
  const flatFolders = useMemo(() => flattenFolderTree(tree), [tree]);
  const breadcrumb = useMemo(() => folderPath(folders, currentFolderId), [folders, currentFolderId]);
  const searching = query.trim().length > 0;
  const childFolders = useMemo(() => {
    if (searching) return [];
    if (currentFolderId === null) return tree.map((node) => node.folder);
    const findNode = (nodes: typeof tree): (typeof tree)[number] | null => {
      for (const node of nodes) {
        if (node.folder.id === currentFolderId) return node;
        const inner = findNode(node.children);
        if (inner) return inner;
      }
      return null;
    };
    return findNode(tree)?.children.map((node) => node.folder) ?? [];
  }, [tree, currentFolderId, searching]);

  const filtered = useMemo(
    () => filterResources(resources, { query, type: typeFilter, folderId: currentFolderId }),
    [resources, query, typeFilter, currentFolderId],
  );
  const counts = useMemo(() => folderResourceCounts(resources), [resources]);
  const selected = useMemo(
    () => (selectedId ? resources.find((resource) => resource.id === selectedId) ?? null : null),
    [selectedId, resources],
  );
  const editFolder = useMemo(
    () => (editFolderId ? folders.find((folder) => folder.id === editFolderId) ?? null : null),
    [editFolderId, folders],
  );

  const postAction = useCallback(
    async (body: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
      if (!live) return null;
      setActionError(null);
      const response = await fetch("/api/library", {
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
      for (const file of Array.from(files)) {
        const key = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        setUploads((current) => [...current, { key, name: file.name, state: "preparing" }]);
        try {
          if (!file.size) {
            setProgress(key, { state: "error", message: "Empty files cannot be uploaded." });
            continue;
          }
          if (file.size > LIBRARY_DB_CAP_BYTES) {
            setProgress(key, { state: "error", message: oversizeFileMessage(file.size) });
            continue;
          }
          const buffer = await file.arrayBuffer();
          const sha256 = await sha256Hex(buffer);
          const fileName = sanitizeFileName(file.name);
          const created = await postAction({
            action: "create-file",
            fileName,
            title: titleFromFileName(fileName),
            contentType: file.type || "application/octet-stream",
            byteSize: file.size,
            sha256,
            folderId: currentFolderId,
            visibility: uploadVisibility,
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
          const put = await fetch(String(created.uploadUrl), { method: "PUT", body: file });
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
    [live, currentFolderId, uploadVisibility, postAction, refresh, setProgress],
  );

  // ---- render ----

  const header = (
    <PageHeader
      title="Library"
      description="The team's shared shelf — CAD, manuals, PDFs, images, code, and links, in folders you control."
    />
  );

  if (loadError) {
    return (
      <div className="tl-page">
        {header}
        <ErrorState message={loadError} onRetry={() => void refresh()} />
      </div>
    );
  }
  if (!view) {
    return (
      <div className="tl-page">
        {header}
        <SoftBlockSkeleton />
      </div>
    );
  }
  if (view.status === "setup_required") {
    return (
      <div className="tl-page">
        {header}
        <EmptyState title="Workspace needed" description={view.message}>
          {view.steps.map((step) => (
            <a key={step.id} className="app-button" href={step.href}>
              {step.label}
            </a>
          ))}
        </EmptyState>
      </div>
    );
  }
  if (!live) return null;

  const shelfEmpty = !resources.length && !folders.length;

  return (
    <div className="tl-page">
      {header}

      <div className="tl-toolbar" role="toolbar" aria-label="Library actions">
        <button type="button" className="app-button" onClick={() => fileInputRef.current?.click()}>
          Upload files
        </button>
        <button type="button" className="app-button secondary" onClick={() => setLinkFormOpen((open) => !open)}>
          Add a link
        </button>
        <button type="button" className="app-button secondary" onClick={() => setFolderFormOpen((open) => !open)}>
          New folder
        </button>
        <label className="tl-upload-visibility">
          Uploads visible to
          <select
            value={uploadVisibility}
            onChange={(event) =>
              setUploadVisibility(event.target.value === "restricted" ? "restricted" : "team")
            }
          >
            <option value="team">Whole team</option>
            <option value="restricted">Only me (share after)</option>
          </select>
        </label>
        <input
          ref={fileInputRef}
          className="tl-hidden-input"
          type="file"
          multiple
          onChange={(event) => {
            void uploadFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      {actionError ? <p className="tl-error" role="alert">{actionError}</p> : null}

      {uploads.length ? (
        <Panel className="tl-uploads" aria-label="Upload progress">
          <ul>
            {uploads.map((upload) => (
              <li key={upload.key} className={upload.state === "error" ? "tl-upload-error" : undefined}>
                <strong>{upload.name}</strong>
                <span>
                  {upload.state === "preparing" && "Preparing…"}
                  {upload.state === "uploading" && "Uploading…"}
                  {upload.state === "done" && "Done"}
                  {(upload.state === "duplicate" || upload.state === "error") && upload.message}
                </span>
              </li>
            ))}
          </ul>
          <button type="button" className="app-button secondary" onClick={() => setUploads([])}>
            Clear list
          </button>
        </Panel>
      ) : null}

      {folderFormOpen ? (
        <FolderCreateForm
          members={live.members}
          viewerId={live.viewerId}
          onCancel={() => setFolderFormOpen(false)}
          onCreate={async (name, visibility, grantUserIds) => {
            const created = await postAction({
              action: "create-folder",
              name,
              parentId: currentFolderId,
              visibility,
              grantUserIds,
            });
            if (created) {
              setFolderFormOpen(false);
              await refresh();
            }
          }}
        />
      ) : null}

      {linkFormOpen ? (
        <LinkCreateForm
          members={live.members}
          viewerId={live.viewerId}
          onCancel={() => setLinkFormOpen(false)}
          onCreate={async (input) => {
            const created = await postAction({
              action: "create-link",
              ...input,
              folderId: currentFolderId,
            });
            if (created) {
              setLinkFormOpen(false);
              await refresh();
            }
          }}
        />
      ) : null}

      <div className="tl-filters">
        <label className="tl-search">
          Search
          <input
            type="search"
            value={query}
            placeholder="Name, tag, notes…"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label>
          Type
          <select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value as LibraryResourceType | "all")}
          >
            {TYPE_FILTERS.map((type) => (
              <option key={type} value={type}>
                {type === "all" ? "All types" : TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!searching ? (
        <nav className="tl-breadcrumb" aria-label="Folder path">
          <button
            type="button"
            className={currentFolderId === null ? "active" : undefined}
            onClick={() => setCurrentFolderId(null)}
          >
            Library
          </button>
          {breadcrumb.map((folder) => (
            <span key={folder.id}>
              <span aria-hidden="true"> / </span>
              <button
                type="button"
                className={folder.id === currentFolderId ? "active" : undefined}
                onClick={() => setCurrentFolderId(folder.id)}
              >
                {folder.name}
              </button>
            </span>
          ))}
        </nav>
      ) : (
        <p className="app-muted tl-search-note">Searching across all folders.</p>
      )}

      {shelfEmpty ? (
        <EmptyState
          soft
          title="No resources yet"
          description="Upload your first file or add a link — CAD, manuals, PDFs, anything the team needs."
        />
      ) : (
        <>
          {childFolders.length ? (
            <div className="tl-folders" role="list" aria-label="Folders">
              {childFolders.map((folder) => (
                <div key={folder.id} className="tl-folder-card" role="listitem">
                  <button
                    type="button"
                    className="tl-folder-open"
                    onClick={() => setCurrentFolderId(folder.id)}
                  >
                    <strong>{folder.name}</strong>
                    <span className="app-muted">
                      {counts.get(folder.id) ?? 0} item{(counts.get(folder.id) ?? 0) === 1 ? "" : "s"}
                      {folder.visibility === "restricted" ? " · restricted" : ""}
                    </span>
                  </button>
                  {folder.canManage ? (
                    <button
                      type="button"
                      className="tl-folder-manage"
                      aria-label={`Manage folder ${folder.name}`}
                      onClick={() => setEditFolderId(folder.id)}
                    >
                      Edit
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {filtered.length ? (
            <ul className="tl-grid">
              {filtered.map((resource) => (
                <li key={resource.id}>
                  <button type="button" className="tl-item" onClick={() => setSelectedId(resource.id)}>
                    <span className="tl-thumb">
                      {resource.previewSrc ? (
                         
                        <img src={resource.previewSrc} alt="" loading="lazy" />
                      ) : (
                        <span className="tl-thumb-fallback">{cardGlyph(resource)}</span>
                      )}
                      {resource.status === "pending" ? <span className="tl-pending">Uploading</span> : null}
                      {resource.visibility === "restricted" ? (
                        <span className="tl-restricted">Restricted</span>
                      ) : null}
                    </span>
                    <span className="tl-item-title">{resource.title}</span>
                    <span className="tl-item-meta app-muted">
                      {resource.kind === "link"
                        ? "External link"
                        : `${resource.fileName ?? ""}${resource.byteSize ? ` · ${formatLibraryBytes(resource.byteSize)}` : ""}`}
                    </span>
                    {resource.tags.length ? (
                      <span className="tl-item-tags">
                        {resource.tags.slice(0, 4).map((tag) => (
                          <span key={tag} className="tl-tag">{tag}</span>
                        ))}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              soft
              title={searching ? "No matches" : "Nothing in this folder yet"}
              description={
                searching
                  ? `Nothing matches "${query.trim()}" with the current type filter.`
                  : "Upload a file or add a link to fill it."
              }
            />
          )}
        </>
      )}

      {selected ? (
        <ResourceDetail
          resource={selected}
          live={live}
          flatFolders={flatFolders}
          membersById={membersById}
          onClose={() => setSelectedId(null)}
          postAction={postAction}
          refresh={refresh}
        />
      ) : null}

      {editFolder ? (
        <FolderDetail
          folder={editFolder}
          folders={folders}
          live={live}
          onClose={() => setEditFolderId(null)}
          onDeleted={() => {
            setEditFolderId(null);
            if (currentFolderId && folderSubtreeIds(folders, editFolder.id).has(currentFolderId)) {
              setCurrentFolderId(null);
            }
          }}
          postAction={postAction}
          refresh={refresh}
        />
      ) : null}
    </div>
  );
}

// ---- create forms ----

function FolderCreateForm({
  members,
  viewerId,
  onCancel,
  onCreate,
}: {
  members: LiveView["members"];
  viewerId: string;
  onCancel: () => void;
  onCreate: (name: string, visibility: LibraryVisibility, grantUserIds: string[]) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<LibraryVisibility>("team");
  const [grants, setGrants] = useState<string[]>([]);
  return (
    <Panel as="form" className="tl-form" onSubmit={(event) => {
      event.preventDefault();
      if (name.trim()) void onCreate(name.trim(), visibility, grants);
    }}>
      <h2>New folder</h2>
      <label>
        Name
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required />
      </label>
      <SharingEditor
        visibility={visibility}
        grantedUserIds={grants}
        members={members}
        viewerId={viewerId}
        onChange={(nextVisibility, nextGrants) => {
          setVisibility(nextVisibility);
          setGrants(nextGrants);
        }}
      />
      <div className="tl-form-actions">
        <button type="submit" className="app-button">Create folder</button>
        <button type="button" className="app-button secondary" onClick={onCancel}>Cancel</button>
      </div>
    </Panel>
  );
}

function LinkCreateForm({
  members,
  viewerId,
  onCancel,
  onCreate,
}: {
  members: LiveView["members"];
  viewerId: string;
  onCancel: () => void;
  onCreate: (input: {
    title: string;
    url: string;
    notes: string | null;
    tags: string[];
    visibility: LibraryVisibility;
    grantUserIds: string[];
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState("");
  const [visibility, setVisibility] = useState<LibraryVisibility>("team");
  const [grants, setGrants] = useState<string[]>([]);
  return (
    <Panel as="form" className="tl-form" onSubmit={(event) => {
      event.preventDefault();
      if (!url.trim()) return;
      void onCreate({
        title: title.trim(),
        url: url.trim(),
        notes: notes.trim() || null,
        tags: parseTagInput(tags),
        visibility,
        grantUserIds: grants,
      });
    }}>
      <h2>Add a link</h2>
      <label>
        URL
        <input
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://…"
          required
        />
      </label>
      <label>
        Title
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={200}
          placeholder="Vendor manual, Google Doc…"
        />
      </label>
      <label>
        Notes
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} maxLength={4000} />
      </label>
      <label>
        Tags (comma-separated)
        <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="swerve, 2026" />
      </label>
      <SharingEditor
        visibility={visibility}
        grantedUserIds={grants}
        members={members}
        viewerId={viewerId}
        onChange={(nextVisibility, nextGrants) => {
          setVisibility(nextVisibility);
          setGrants(nextGrants);
        }}
      />
      <div className="tl-form-actions">
        <button type="submit" className="app-button">Add link</button>
        <button type="button" className="app-button secondary" onClick={onCancel}>Cancel</button>
      </div>
    </Panel>
  );
}

// ---- detail overlays ----

function ResourceDetail({
  resource,
  live,
  flatFolders,
  membersById,
  onClose,
  postAction,
  refresh,
}: {
  resource: LibraryResource;
  live: LiveView;
  flatFolders: Array<{ folder: LibraryFolder; depth: number }>;
  membersById: Map<string, string | null>;
  onClose: () => void;
  postAction: (body: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
  refresh: () => Promise<void>;
}) {
  const [title, setTitle] = useState(resource.title);
  const [notes, setNotes] = useState(resource.notes ?? "");
  const [tags, setTags] = useState(resource.tags.join(", "));
  const [folderId, setFolderId] = useState<string>(resource.folderId ?? "");
  const [visibility, setVisibility] = useState<LibraryVisibility>(resource.visibility);
  const [grants, setGrants] = useState<string[]>(resource.grantedUserIds ?? []);
  const [linkTitle, setLinkTitle] = useState("");
  const [linkUrl, setLinkUrl] = useState("");

  const save = async () => {
    const updated = await postAction({
      action: "update-resource",
      resourceId: resource.id,
      title: title.trim() || resource.title,
      notes: notes.trim() || null,
      tags: parseTagInput(tags),
      folderId: folderId || null,
    });
    if (updated && (visibility !== resource.visibility || visibility === "restricted")) {
      await postAction({
        action: "set-sharing",
        resourceId: resource.id,
        visibility,
        grantUserIds: grants,
      });
    }
    if (updated) await refresh();
  };

  const remove = async () => {
    if (!window.confirm(`Delete "${resource.title}" permanently?`)) return;
    const deleted = await postAction({ action: "delete-resource", resourceId: resource.id });
    if (deleted) {
      onClose();
      await refresh();
    }
  };

  const attachLink = async () => {
    if (!linkUrl.trim()) return;
    const added = await postAction({
      action: "add-link",
      resourceId: resource.id,
      title: linkTitle.trim(),
      url: linkUrl.trim(),
    });
    if (added) {
      setLinkTitle("");
      setLinkUrl("");
      await refresh();
    }
  };

  return (
    <div className="tl-overlay" role="dialog" aria-modal="true" aria-label={resource.title} onClick={onClose}>
      <Panel className="tl-detail" onClick={(event) => event.stopPropagation()}>
        <div className="tl-detail-head">
          <h2>{resource.title}</h2>
          <button type="button" className="app-button secondary" onClick={onClose}>Close</button>
        </div>

        {resource.kind === "link" ? (
          <div className="tl-download-card">
            <span className="tl-thumb-fallback">LINK</span>
            <div>
              <p className="tl-download-name">{resource.url}</p>
              <a className="app-button" href={resource.url ?? "#"} target="_blank" rel="noreferrer noopener">
                Open link
              </a>
            </div>
          </div>
        ) : resource.previewSrc ? (
          <div className="tl-detail-media">
            { }
            <img src={resource.previewSrc} alt={resource.title} />
            <a className="app-button" href={resource.src ?? "#"}>Download</a>
          </div>
        ) : (
          <div className="tl-download-card">
            <span className="tl-thumb-fallback">{cardGlyph(resource)}</span>
            <div>
              <p className="tl-download-name">
                {resource.fileName}
                {resource.byteSize ? ` · ${formatLibraryBytes(resource.byteSize)}` : ""}
              </p>
              {resource.status === "ready" && resource.src ? (
                <a className="app-button" href={resource.src}>Download</a>
              ) : (
                <p className="app-muted">Upload has not finished yet.</p>
              )}
            </div>
          </div>
        )}

        <p className="tl-detail-meta app-muted">
          {resource.kind === "link" ? "Link" : resource.contentType} · shared by{" "}
          {resource.createdByName ?? "a member"} ·{" "}
          {describeAudience(
            { visibility: resource.visibility, createdBy: resource.createdBy, grantedUserIds: resource.grantedUserIds },
            membersById,
          )}
        </p>
        {resource.notes ? <p className="tl-detail-notes">{resource.notes}</p> : null}

        <section className="tl-links" aria-label="Related links">
          <h3>Related links</h3>
          {resource.links.length ? (
            <ul>
              {resource.links.map((link) => (
                <li key={link.id}>
                  <a href={link.url} target="_blank" rel="noreferrer noopener">{link.title}</a>
                  {link.notes ? <span className="app-muted"> — {link.notes}</span> : null}
                  {link.canRemove ? (
                    <button
                      type="button"
                      className="tl-link-remove"
                      onClick={() => {
                        void postAction({ action: "remove-link", linkId: link.id }).then(
                          (ok) => ok && refresh(),
                        );
                      }}
                    >
                      Remove
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="app-muted">No related links yet.</p>
          )}
          <div className="tl-link-add">
            <input
              type="url"
              value={linkUrl}
              onChange={(event) => setLinkUrl(event.target.value)}
              placeholder="https://vendor page, manual…"
              aria-label="Related link URL"
            />
            <input
              value={linkTitle}
              onChange={(event) => setLinkTitle(event.target.value)}
              placeholder="Title (optional)"
              aria-label="Related link title"
              maxLength={200}
            />
            <button type="button" className="app-button secondary" onClick={() => void attachLink()}>
              Attach link
            </button>
          </div>
        </section>

        {resource.canManage ? (
          <section className="tl-detail-form" aria-label="Edit resource">
            <h3>Edit</h3>
            <label>
              Title
              <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} />
            </label>
            <label>
              Notes
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} maxLength={4000} />
            </label>
            <div className="tl-detail-row">
              <label>
                Tags
                <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="comma-separated" />
              </label>
              <label>
                Folder
                <select value={folderId} onChange={(event) => setFolderId(event.target.value)}>
                  <option value="">Library root</option>
                  {flatFolders.map(({ folder, depth }) => (
                    <option key={folder.id} value={folder.id}>
                      {`${"— ".repeat(depth)}${folder.name}`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <SharingEditor
              visibility={visibility}
              grantedUserIds={grants}
              members={live.members}
              viewerId={live.viewerId}
              onChange={(nextVisibility, nextGrants) => {
                setVisibility(nextVisibility);
                setGrants(nextGrants);
              }}
            />
            <div className="tl-detail-actions">
              <button type="button" className="app-button" onClick={() => void save()}>Save</button>
              <button type="button" className="app-button danger" onClick={() => void remove()}>Delete</button>
            </div>
          </section>
        ) : null}
      </Panel>
    </div>
  );
}

function FolderDetail({
  folder,
  folders,
  live,
  onClose,
  onDeleted,
  postAction,
  refresh,
}: {
  folder: LibraryFolder;
  folders: LibraryFolder[];
  live: LiveView;
  onClose: () => void;
  onDeleted: () => void;
  postAction: (body: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
  refresh: () => Promise<void>;
}) {
  const [name, setName] = useState(folder.name);
  const [parentId, setParentId] = useState<string>(folder.parentId ?? "");
  const [visibility, setVisibility] = useState<LibraryVisibility>(folder.visibility);
  const [grants, setGrants] = useState<string[]>(folder.grantedUserIds ?? []);

  const subtree = useMemo(() => folderSubtreeIds(folders, folder.id), [folders, folder.id]);
  const moveTargets = useMemo(
    () =>
      flattenFolderTree(buildFolderTree(folders)).filter(
        ({ folder: candidate }) =>
          !subtree.has(candidate.id) && !wouldCreateCycle(folders, folder.id, candidate.id),
      ),
    [folders, folder.id, subtree],
  );

  const save = async () => {
    const updated = await postAction({
      action: "update-folder",
      folderId: folder.id,
      name: name.trim() || folder.name,
      parentId: parentId || null,
      visibility,
      grantUserIds: visibility === "restricted" ? grants : [],
    });
    if (updated) {
      onClose();
      await refresh();
    }
  };

  const remove = async () => {
    if (
      !window.confirm(
        `Delete folder "${folder.name}"? Subfolders are deleted too; files inside move to the library root.`,
      )
    ) {
      return;
    }
    const deleted = await postAction({ action: "delete-folder", folderId: folder.id });
    if (deleted) {
      onDeleted();
      await refresh();
    }
  };

  return (
    <div className="tl-overlay" role="dialog" aria-modal="true" aria-label={`Manage ${folder.name}`} onClick={onClose}>
      <Panel className="tl-detail" onClick={(event) => event.stopPropagation()}>
        <div className="tl-detail-head">
          <h2>Manage folder</h2>
          <button type="button" className="app-button secondary" onClick={onClose}>Close</button>
        </div>
        <section className="tl-detail-form">
          <label>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
          </label>
          <label>
            Inside
            <select value={parentId} onChange={(event) => setParentId(event.target.value)}>
              <option value="">Library root</option>
              {moveTargets.map(({ folder: candidate, depth }) => (
                <option key={candidate.id} value={candidate.id}>
                  {`${"— ".repeat(depth)}${candidate.name}`}
                </option>
              ))}
            </select>
          </label>
          <SharingEditor
            visibility={visibility}
            grantedUserIds={grants}
            members={live.members}
            viewerId={live.viewerId}
            onChange={(nextVisibility, nextGrants) => {
              setVisibility(nextVisibility);
              setGrants(nextGrants);
            }}
          />
          <div className="tl-detail-actions">
            <button type="button" className="app-button" onClick={() => void save()}>Save</button>
            <button type="button" className="app-button danger" onClick={() => void remove()}>Delete folder</button>
          </div>
        </section>
      </Panel>
    </div>
  );
}
