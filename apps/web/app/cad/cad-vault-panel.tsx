"use client";

/**
 * The CAD vault, inside the CAD workbench: the team's STL/STEP/DXF files next
 * to the live model. Lists documents from /api/cad-vault, uploads a file (new
 * document or new version), deep-links into the full vault, and offers the
 * "need this part → purchase request" action for the selected document.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { titleFromFilename } from "../../lib/cad-vault/filenames";
import type { CadDocumentSummary, CadVaultView } from "../../lib/cad-vault/view";
import { CadPurchaseRequestPanel } from "./cad-purchase-request";

type ReadyView = Extract<CadVaultView, { status: "empty" | "ready" }>;

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function relative(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function CadVaultPanel({
  orgId,
  refreshKey,
  active,
}: {
  orgId: string;
  /** Bump to refetch (an export just saved a version, a plan step finished). */
  refreshKey: number;
  /** Fetch only while the panel is on screen. */
  active: boolean;
}) {
  const [view, setView] = useState<ReadyView | null>(null);
  const [failure, setFailure] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [targetId, setTargetId] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/cad-vault?orgId=${encodeURIComponent(orgId)}`);
      const data = (await response.json()) as CadVaultView | { error?: string };
      if (!response.ok || !("status" in data)) throw new Error(("error" in data && data.error) || "Could not load the vault");
      if (data.status === "setup_required") {
        setView(null);
        setFailure(data.message);
        return;
      }
      setView(data);
      setFailure("");
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Could not load the vault");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    if (active) void load();
  }, [active, load, refreshKey]);

  const documents: CadDocumentSummary[] = view?.documents ?? [];


  async function upload() {
    if (!file || busy) return;
    setBusy(true);
    setNotice("");
    try {
      let documentId = targetId;
      if (!documentId) {
        const created = await fetch("/api/cad-vault", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, title: title.trim() || titleFromFilename(file.name), kind: "part" }),
        });
        const data = (await created.json()) as { documentId?: string; error?: string };
        if (!created.ok || !data.documentId) throw new Error(data.error ?? "Could not create the document");
        documentId = data.documentId;
      }
      const form = new FormData();
      form.set("orgId", orgId);
      form.set("file", file);
      const stored = await fetch(`/api/cad-vault/${encodeURIComponent(documentId)}/versions`, { method: "POST", body: form });
      const result = (await stored.json()) as { version?: number; duplicate?: boolean; error?: string };
      if (!stored.ok) throw new Error(result.error ?? "Could not store the file");
      setNotice(result.duplicate ? `Identical bytes already stored as v${result.version}.` : `Stored as v${result.version}.`);
      setFile(null);
      setTitle("");
      setTargetId("");
      if (fileRef.current) fileRef.current.value = "";
      setSelectedId(documentId);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  const vaultHref = `/cad-vault?orgId=${encodeURIComponent(orgId)}`;

  return (
    <div className="cad-files">
      <div className="cad-files-toolbar">
        <span className="cad-agent-hint">
          {view ? `${documents.length} document${documents.length === 1 ? "" : "s"} · ${formatBytes(view.totalBytes)} · season ${view.seasonYear}` : "Team CAD files"}
        </span>
        <span className="cad-files-toolbar-actions">
          <button type="button" className="app-button secondary" disabled={loading} onClick={() => void load()}>
            {loading ? "Loading…" : "Refresh"}
          </button>
          <a className="app-button secondary" href={vaultHref}>
            Open full vault
          </a>
        </span>
      </div>

      {failure ? <p className="cad-agent-error">{failure}</p> : null}

      <form
        className="cad-files-upload"
        onSubmit={(event) => {
          event.preventDefault();
          void upload();
        }}
      >
        <label>
          <span>File (STL, STEP, DXF, 3MF, …)</span>
          <input
            ref={fileRef}
            type="file"
            disabled={busy}
            onChange={(event) => {
              const next = event.target.files?.[0] ?? null;
              setFile(next);
              if (next && !targetId && !title) setTitle(titleFromFilename(next.name));
            }}
          />
        </label>
        <label>
          <span>Add as</span>
          <select value={targetId} disabled={busy} onChange={(event) => setTargetId(event.target.value)}>
            <option value="">New document</option>
            {documents.map((doc) => (
              <option key={doc.id} value={doc.id}>
                New version of “{doc.title}” (v{doc.currentVersion})
              </option>
            ))}
          </select>
        </label>
        {!targetId ? (
          <label>
            <span>Title</span>
            <input value={title} maxLength={160} disabled={busy} onChange={(event) => setTitle(event.target.value)} placeholder="Drive plate" />
          </label>
        ) : null}
        <button className="app-button" type="submit" disabled={!file || busy}>
          {busy ? "Uploading…" : "Upload"}
        </button>
        {notice ? <span className="cad-agent-hint">{notice}</span> : null}
      </form>

      {view && documents.length === 0 ? (
        <p className="cad-agent-empty-view cad-files-empty">
          No files in the vault yet. Upload one above, or run <code>export STL</code> / <code>export STEP</code> in the agent and
          the file lands here as a version.
        </p>
      ) : null}

      {documents.length ? (
        <ul className="cad-files-list">
          {documents.map((doc) => (
            <li key={doc.id} className={`cad-files-item${selectedId === doc.id ? " active" : ""}`}>
              <button type="button" className="cad-files-row" aria-pressed={selectedId === doc.id} onClick={() => setSelectedId(doc.id)}>
                {doc.latest?.hasThumbnail ? (
                  <img
                    className="cad-files-thumb"
                    src={`/api/cad-vault/file/${doc.latest.publicId}/thumbnail`}
                    alt=""
                    width={44}
                    height={44}
                  />
                ) : (
                  <span className="cad-files-thumb cad-files-thumb--empty">{doc.latest?.format.toUpperCase() ?? "—"}</span>
                )}
                <span className="cad-files-meta">
                  <span className="cad-files-title">{doc.title}</span>
                  <span className="cad-agent-hint">
                    {doc.latest
                      ? `v${doc.latest.version} · ${doc.latest.format.toUpperCase()} · ${formatBytes(doc.latest.byteSize)}`
                      : "no versions yet"}
                    {doc.subsystemName ? ` · ${doc.subsystemName}` : ""}
                    {doc.updatedAt ? ` · ${relative(doc.updatedAt)}` : ""}
                  </span>
                </span>
              </button>
              {selectedId === doc.id ? (
                <div className="cad-files-detail">
                  {doc.latest ? (
                    <a className="app-button secondary" href={`/api/cad-vault/file/${doc.latest.publicId}`}>
                      Download v{doc.latest.version}
                    </a>
                  ) : null}
                  <a className="app-button secondary" href={`${vaultHref}&document=${encodeURIComponent(doc.id)}`}>
                    Open in vault
                  </a>
                  {doc.externalUrl ? (
                    <a className="app-button secondary" href={doc.externalUrl} target="_blank" rel="noreferrer">
                      Open source model
                    </a>
                  ) : null}
                  <CadPurchaseRequestPanel
                    orgId={orgId}
                    defaultTitle={doc.title}
                    defaultWhy={`Needed for ${doc.title}${doc.subsystemName ? ` (${doc.subsystemName})` : ""} — see the CAD vault.`}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
