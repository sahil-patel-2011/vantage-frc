"use client";

/**
 * CAD vault client: link Onshape/Fusion by title, then upload printable files.
 * Geometry is a face count only — never shown as kilograms.
 */

import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { FormGrid, FormRow, Panel, ProgressMeter, Button } from "../../components/ui";
import { titleFromFilename } from "../../lib/cad-vault/filenames";
import { detectCadFormat, type CadFormat } from "../../lib/cad-vault/format-detect";
import {
  CAD_DOCUMENT_KINDS,
  cadKindLabel,
  type CadDocumentKind,
  type CadVaultView,
} from "../../lib/cad-vault/view";
import { cadVaultHasLiveLink, classifyCadVaultShell } from "../../lib/cad-vault/cad-vault-related";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import {
  clearFeatureSnapshot,
  getFeatureSnapshot,
  putFeatureSnapshot,
} from "../../lib/offline/feature-cache";
import "../cad/cad-setup.css";
import { CadVaultEmptyCard, CadVaultHeader, CadVaultNextActions } from "./cad-vault-chrome";
import { DocumentCard } from "./cad-vault-document-card";
import { formatBytes, MAX_INLINE_PREVIEW_BYTES, StlCanvas } from "./cad-vault-preview";
import { LinkCadPanel } from "./link-cad";

type ReadyView = Extract<CadVaultView, { status: "empty" | "ready" }>;

function isCadVaultView(value: unknown): value is CadVaultView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "empty" || status === "ready";
}

function cadVaultCacheOrg(data: CadVaultView, orgHint: string): string {
  if (typeof data.orgId === "string" && data.orgId.trim()) return data.orgId;
  return orgHint;
}

async function persistCadVaultSnapshot(orgHint: string, seasonHint: string, data: CadVaultView): Promise<void> {
  const cacheOrg = cadVaultCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = String(data.seasonYear);
  try {
    await putFeatureSnapshot("cad-vault", cacheOrg, data, seasonHint || seasonKey);
    await putFeatureSnapshot("cad-vault", "_", data, seasonHint || seasonKey);
  } catch {
    // Live CAD vault already painted; IndexedDB is best-effort.
  }
}

function xhrUpload(
  url: string,
  form: FormData,
  onProgress: (pct: number) => void,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> | null }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      let body: Record<string, unknown> | null;
      try {
        body = JSON.parse(xhr.responseText) as Record<string, unknown>;
      } catch {
        body = null;
      }
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, body });
    };
    xhr.onerror = () => resolve({ ok: false, status: 0, body: null });
    xhr.send(form);
  });
}

type PendingUpload = {
  file: File;
  bytes: Uint8Array;
  format: CadFormat;
};

export default function CadVaultClient() {
  const [view, setView] = useState<CadVaultView | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [authBlocked, setAuthBlocked] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [seasonYear, setSeasonYear] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const viewRef = useRef<CadVaultView | null>(null);
  viewRef.current = view;

  const [pending, setPending] = useState<PendingUpload | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadKind, setUploadKind] = useState<CadDocumentKind>("part");
  const [uploadSubsystem, setUploadSubsystem] = useState("");
  const [uploadChangeNote, setUploadChangeNote] = useState("");
  const [targetDocumentId, setTargetDocumentId] = useState("");
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async (season?: number | null) => {
    const params = new URLSearchParams(window.location.search);
    const orgHint = params.get("orgId")?.trim() ?? "";
    const seasonQuery = season != null ? season : (params.get("seasonYear") ? Number(params.get("seasonYear")) : null);
    const seasonHint =
      seasonQuery != null && Number.isFinite(seasonQuery) ? String(seasonQuery) : String(new Date().getFullYear());
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<CadVaultView>("cad-vault", orgHint || "_", seasonHint);
      if (!viewRef.current && cached?.data && isCadVaultView(cached.data)) {
        setView(cached.data);
        setSeasonYear(cached.data.seasonYear);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setFetchFailed(false);
    setAuthBlocked(false);
    setError("");
    try {
      const query = new URLSearchParams();
      if (orgHint) query.set("orgId", orgHint);
      if (seasonQuery != null && Number.isFinite(seasonQuery)) query.set("seasonYear", String(seasonQuery));
      const response = await fetch(`/api/cad-vault${query.toString() ? `?${query.toString()}` : ""}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        await clearFeatureSnapshot("cad-vault", orgHint || "_", seasonHint);
        await clearFeatureSnapshot("cad-vault", "_", seasonHint);
        if (orgHint) await clearFeatureSnapshot("cad-vault", orgHint, seasonHint);
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setAuthBlocked(true);
        setFetchFailed(false);
        return;
      }
      if (!response.ok || !isCadVaultView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh CAD vault. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        return;
      }
      setView(data);
      setSeasonYear(data.seasonYear);
      setFromCache(false);
      setCachedAt(null);
      await persistCadVaultSnapshot(orgHint, seasonHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh CAD vault. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const orgId = view && "orgId" in view ? view.orgId : null;
  const ready: ReadyView | null = view && (view.status === "ready" || view.status === "empty") ? view : null;

  const acceptFile = useCallback(
    (file: File | null | undefined) => {
      setError("");
      setNotice("");
      if (!file) return;
      void file.arrayBuffer().then((buffer) => {
        const bytes = new Uint8Array(buffer);
        const detection = detectCadFormat(bytes, file.name);
        if (!detection.ok) {
          setPending(null);
          setError(detection.reason);
          return;
        }
        setPending({ file, bytes, format: detection.format });
        if (!targetDocumentId) setUploadTitle(titleFromFilename(file.name));
      });
    },
    [targetDocumentId],
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragActive(false);
      acceptFile(event.dataTransfer.files?.[0]);
    },
    [acceptFile],
  );

  const resetUploadPanel = useCallback(() => {
    setPending(null);
    setUploadTitle("");
    setUploadChangeNote("");
    setUploadPct(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const submitUpload = useCallback(async () => {
    if (!pending || !orgId || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      let documentId = targetDocumentId;
      if (!documentId) {
        const title = uploadTitle.trim();
        if (!title) {
          setError("Give the document a title.");
          return;
        }
        const created = await fetch("/api/cad-vault", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            orgId,
            title,
            seasonYear: seasonYear ?? undefined,
            kind: uploadKind,
            subsystemId: uploadSubsystem || undefined,
          }),
        });
        const createdBody = (await created.json()) as { documentId?: string; error?: string };
        if (!created.ok || !createdBody.documentId) {
          setError(createdBody.error ?? "Could not create the document.");
          return;
        }
        documentId = createdBody.documentId;
      }

      const form = new FormData();
      form.set("orgId", orgId);
      if (uploadChangeNote.trim()) form.set("changeNote", uploadChangeNote.trim());
      form.set("file", pending.file, pending.file.name);
      setUploadPct(0);
      const result = await xhrUpload(`/api/cad-vault/${documentId}/versions`, form, setUploadPct);
      if (!result.ok) {
        setError(
          typeof result.body?.error === "string"
            ? result.body.error
            : result.status === 413
              ? `This ${formatBytes(pending.file.size)} file exceeds what the server accepts in one request. Export a lighter mesh or split the assembly.`
              : "Upload failed — please try again.",
        );
        setUploadPct(null);
        return;
      }
      if (result.body?.duplicate === true) {
        setNotice(`Identical bytes are already stored as v${String(result.body.version)} — nothing was re-uploaded.`);
      } else {
        setNotice(`Stored ${String(result.body?.filename ?? pending.file.name)} as v${String(result.body?.version ?? "?")}.`);
      }
      resetUploadPanel();
      setTargetDocumentId("");
      load(seasonYear);
    } finally {
      setBusy(false);
    }
  }, [pending, orgId, busy, targetDocumentId, uploadTitle, uploadKind, uploadSubsystem, uploadChangeNote, seasonYear, resetUploadPanel, load]);

  const patchDocument = useCallback(
    (documentId: string, payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      void fetch("/api/cad-vault", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, documentId, ...payload }),
      })
        .then(async (response) => {
          const data = (await response.json()) as CadVaultView | { error?: string };
          if (!response.ok || !("status" in data)) {
            setError("error" in data && data.error ? data.error : "Could not update the document.");
            return;
          }
          setView(data);
          if ("seasonYear" in data) setSeasonYear(data.seasonYear);
          setFromCache(false);
          void persistCadVaultSnapshot(orgId ?? "", String(data.seasonYear), data);
        })
        .catch(() => setError("Network error — please try again."))
        .finally(() => setBusy(false));
    },
    [orgId, busy],
  );

  const restoreVersion = useCallback(
    (documentId: string, version: number) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      setNotice("");
      void fetch(`/api/cad-vault/${documentId}/versions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, restoreFromVersion: version }),
      })
        .then(async (response) => {
          const data = (await response.json()) as { version?: number; error?: string };
          if (!response.ok) {
            setError(data.error ?? "Could not restore that version.");
            return;
          }
          setNotice(`Restored v${version} as new v${String(data.version ?? "?")}.`);
          load(seasonYear);
        })
        .catch(() => setError("Network error — please try again."))
        .finally(() => setBusy(false));
    },
    [orgId, busy, load, seasonYear],
  );

  if (!view) {
    const shell = classifyCadVaultShell({ authBlocked, fetchFailed });
    return (
      <main className="module-page cad-vault-page">
        <CadVaultHeader orgId={null} />
        <OfflineBanner feature="CAD vault" fromCache={fromCache} cachedAt={cachedAt} />
        <CadVaultEmptyCard
          shell={shell}
          onRetry={shell === "error" ? () => void load(seasonYear) : undefined}
        />
      </main>
    );
  }

  if (view.status === "setup_required") {
    return (
      <main className="module-page cad-vault-page soft-gate">
        <CadVaultHeader orgId={view.orgId} />
        <OfflineBanner feature="CAD vault" fromCache={fromCache} cachedAt={cachedAt} />
        {error ? (
          <p className="telemetry-status" role="alert">
            {error}
          </p>
        ) : null}
        <CadVaultEmptyCard shell="setup" description={view.message} />
      </main>
    );
  }

  const documents = ready?.documents ?? [];
  const subsystems = ready?.subsystems ?? [];
  const seasons = ready?.seasons ?? [];
  const linkedCount = documents.filter((doc) => cadVaultHasLiveLink(doc.externalUrl)).length;

  const uploadPanel = (
    <Panel aria-label="Upload a CAD file" style={{ display: "grid", gap: 12 }}>
      <h2 style={{ margin: 0 }}>Upload a printable file</h2>
      <p className="app-muted" style={{ margin: 0 }}>
        STL, STEP, and vendor files. We check the file type from the bytes, not the name. This is storage, not a CAD
        editor.
      </p>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        style={{
          border: `2px dashed ${dragActive ? "var(--accent)" : "var(--line)"}`,
          borderRadius: "var(--radius-sm, 12px)",
          padding: 16,
          display: "grid",
          gap: 8,
          justifyItems: "center",
          textAlign: "center",
          minHeight: 96,
          alignContent: "center",
          background: dragActive ? "var(--surface-2, transparent)" : "transparent",
        }}
      >
        {pending ? (
          <>
            <strong>{pending.file.name}</strong>
            <span className="app-muted">
              <small>
                Detected {pending.format.toUpperCase()} from the file bytes · {formatBytes(pending.file.size)}
              </small>
            </span>
            {pending.format === "stl" && pending.file.size <= MAX_INLINE_PREVIEW_BYTES ? (
              <StlCanvas data={pending.bytes} label={`Preview of ${pending.file.name}`} />
            ) : null}
            <Button variant="secondary" type="button" onClick={resetUploadPanel} disabled={busy}>
              Choose a different file
            </Button>
          </>
        ) : (
          <>
            <span className="app-muted">Drag a CAD file here, or</span>
            <Button as="label" variant="secondary" style={{ cursor: "pointer" }}>
              Browse files
              <input
                ref={fileInputRef}
                type="file"
                accept=".stl,.step,.stp,.iges,.igs,.3mf,.obj,.dxf,.pdf,.sldprt,.sldasm,.f3d,.ipt,.iam,.zip"
                style={{ position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden" }}
                onChange={(event) => acceptFile(event.target.files?.[0])}
              />
            </Button>
            <span className="app-muted">
              <small>STL · STEP · IGES · 3MF · OBJ · DXF · PDF · SolidWorks · Inventor · Fusion · ZIP — up to 50 MB.</small>
            </span>
          </>
        )}
      </div>

      {pending ? (
        <>
          <FormGrid min={180}>
            <FormRow label="Add to">
              <select value={targetDocumentId} onChange={(event) => setTargetDocumentId(event.target.value)} disabled={busy}>
                <option value="">New document</option>
                {documents
                  .filter((doc) => doc.status !== "archived")
                  .map((doc) => (
                    <option key={doc.id} value={doc.id}>
                      New version of: {doc.title}
                    </option>
                  ))}
              </select>
            </FormRow>
            {targetDocumentId === "" ? (
              <>
                <FormRow label="Title">
                  <input
                    value={uploadTitle}
                    onChange={(event) => setUploadTitle(event.target.value)}
                    maxLength={160}
                    required
                    disabled={busy}
                  />
                </FormRow>
                <FormRow label="Kind">
                  <select value={uploadKind} onChange={(event) => setUploadKind(event.target.value as CadDocumentKind)} disabled={busy}>
                    {CAD_DOCUMENT_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {cadKindLabel(kind)}
                      </option>
                    ))}
                  </select>
                </FormRow>
                <FormRow
                  label="Subsystem"
                  hint={subsystems.length === 0 ? "No subsystems this season — add them on the robot spec sheet." : undefined}
                >
                  <select value={uploadSubsystem} onChange={(event) => setUploadSubsystem(event.target.value)} disabled={busy}>
                    <option value="">Unassigned</option>
                    {subsystems.map((subsystem) => (
                      <option key={subsystem.id} value={subsystem.id}>
                        {subsystem.name}
                      </option>
                    ))}
                  </select>
                </FormRow>
              </>
            ) : null}
            <FormRow label="Change note (optional)">
              <input
                value={uploadChangeNote}
                onChange={(event) => setUploadChangeNote(event.target.value)}
                maxLength={500}
                placeholder="What changed in this revision?"
                disabled={busy}
              />
            </FormRow>
          </FormGrid>
          {uploadPct != null ? (
            <ProgressMeter value={uploadPct} label="Uploading" status={uploadPct >= 100 ? "Processing on the server…" : undefined} />
          ) : null}
          <div>
            <Button variant="primary" type="button" disabled={busy || (targetDocumentId === "" && !uploadTitle.trim())} onClick={() => void submitUpload()}>
              {targetDocumentId === "" ? "Create document & upload v1" : "Upload new version"}
            </Button>
          </div>
        </>
      ) : null}
    </Panel>
  );

  return (
    <main className="module-page cad-vault-page">
      <CadVaultHeader orgId={orgId}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {seasons.length > 1 ? (
            <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              Season
              <select
                value={seasonYear ?? ""}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setSeasonYear(next);
                  load(next);
                }}
              >
                {seasons.map((season) => (
                  <option key={season} value={season}>
                    {season}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <span className="app-badge">{formatBytes(ready?.totalBytes ?? 0)} of 2 GB</span>
        </div>
      </CadVaultHeader>
      <OfflineBanner feature="CAD vault" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="telemetry-status" role="status">
          {notice}
        </p>
      ) : null}

      <div style={{ display: "grid", gap: 16 }}>
        {view.status === "ready" ? (
          <CadVaultNextActions
            orgId={orgId}
            shell="ready"
            documentCount={documents.length}
            linkedCount={linkedCount}
          />
        ) : null}

        {view.status === "empty" ? <CadVaultEmptyCard shell="empty" /> : null}

        {orgId ? (
          <LinkCadPanel
            orgId={orgId}
            seasonYear={seasonYear}
            subteams={subsystems}
            busy={busy}
            onCreated={(title) => {
              setNotice(`Linked "${title}".`);
              load(seasonYear);
            }}
          />
        ) : null}

        {view.status === "empty" ? <details>{/* printable files stay secondary on empty */}
          <summary>Or upload a printable file</summary>
          <div style={{ marginTop: 12 }}>{uploadPanel}</div>
        </details> : uploadPanel}

        {documents.map((doc) => (
          <DocumentCard
            key={doc.id}
            doc={doc}
            subsystems={subsystems}
            busy={busy}
            onPatch={patchDocument}
            onRestore={restoreVersion}
            onUploadVersion={(id) => {
              setTargetDocumentId(id);
              setNotice("");
              setError("");
              fileInputRef.current?.click();
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        ))}

        {ready && ready.rollup.length > 0 ? (
          <Panel aria-label="Vault by subsystem">
            <h2 style={{ marginTop: 0 }}>By subsystem</h2>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
              {ready.rollup.map((row) => (
                <li key={row.subsystemId ?? "unassigned"} style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <strong>{row.subsystemName}</strong>
                  <span className="app-muted">
                    {row.documentCount} document{row.documentCount === 1 ? "" : "s"} · {row.versionCount} version
                    {row.versionCount === 1 ? "" : "s"} · {formatBytes(row.totalBytes)}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}
      </div>
    </main>
  );
}
