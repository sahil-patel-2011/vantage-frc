"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { EmptyState, Panel, Button } from "../../components/ui";
import {
  drivePreviewKind,
  formatDriveBytes,
  parseShareEmails,
} from "../../lib/drive/validation";
import type { DriveFile, DriveFolder, DriveShare } from "../../lib/drive/types";
import { driveFileOfflineKey } from "../../lib/offline/file-bytes";
import type { UploadItem } from "./upload-queue";
import { fileIcon, formatWhen, storageLabel, type Listing, type Rail } from "./files-model";

export function UploadList({ uploads, onClear }: { uploads: UploadItem[]; onClear: () => void }) {
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
                  ? "Checking the file"
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

export function Body(props: BodyProps) {
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
            {listing.usage.nodeBytes > 0
              ? ` · ${formatDriveBytes(listing.usage.nodeBytes)} on your storage node`
              : ""}
            {listing.usage.objectBytes > 0
              ? ` · ${formatDriveBytes(listing.usage.objectBytes)} in hosted storage`
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

export function NewFolderButton({ onCreate }: { onCreate: (name: string) => Promise<void> }) {
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

export function FileGrid(props: FileGridProps) {
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

export function RenameButton({
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

export function PreviewPane({
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

export function ShareDialog({
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
