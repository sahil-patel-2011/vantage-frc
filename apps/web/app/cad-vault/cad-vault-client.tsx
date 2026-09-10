"use client";

/**
 * CAD Vault client: upload, version, link to a subsystem, download.
 * Honesty rules baked in: geometry is shown only for server-parsed STL —
 * every other format says "no geometry summary for this format"; nothing is
 * ever fabricated. The inline 3D preview shares the exact same parse +
 * raster modules the server thumbnail uses.
 */

import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, ProgressMeter, Button } from "../../components/ui";
import { titleFromFilename } from "../../lib/cad-vault/filenames";
import { detectCadFormat, type CadFormat } from "../../lib/cad-vault/format-detect";
import { parseStl } from "../../lib/cad-vault/stl-geometry";
import { rasterizeStl } from "../../lib/cad-vault/stl-render";
import {
  CAD_DOCUMENT_KINDS,
  cadKindLabel,
  type CadDocumentKind,
  type CadDocumentSummary,
  type CadVaultView,
  type CadVersionSummary,
  type SubsystemOption,
} from "../../lib/cad-vault/view";
import { withOrgHref } from "../../lib/nav/product-nav";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { LinkOnshapePanel } from "./link-onshape";

const MAX_INLINE_PREVIEW_BYTES = 20 * 1024 * 1024; // above this, use the stored thumbnail

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
    if (!orgHint) await putFeatureSnapshot("cad-vault", "_", data, seasonHint || seasonKey);
  } catch {
    // Live CAD Vault already painted; IndexedDB is best-effort.
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** Narrow the stored jsonb geometry into the fields we actually render. */
function readGeometry(geometry: Record<string, unknown> | null) {
  if (!geometry) return null;
  const triangleCount = typeof geometry.triangleCount === "number" ? geometry.triangleCount : null;
  const volume = typeof geometry.volume === "number" ? geometry.volume : null;
  const surfaceArea = typeof geometry.surfaceArea === "number" ? geometry.surfaceArea : null;
  const degenerate = typeof geometry.degenerateTriangleCount === "number" ? geometry.degenerateTriangleCount : null;
  const box = geometry.boundingBox as { min?: unknown; max?: unknown } | undefined;
  const minArr = box?.min;
  const maxArr = box?.max;
  let dims: [number, number, number] | null = null;
  if (Array.isArray(minArr) && Array.isArray(maxArr) && minArr.length === 3 && maxArr.length === 3) {
    dims = [0, 1, 2].map((i) => Number(maxArr[i]) - Number(minArr[i])) as [number, number, number];
  }
  if (triangleCount == null) return null;
  return { triangleCount, volume, surfaceArea, degenerate, dims };
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

/** Draw an already-parsed STL triangle soup on a canvas (same raster as the server). */
function StlCanvas({ data, label }: { data: Uint8Array; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [failure, setFailure] = useState("");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const triangles = parseStl(data);
      const raster = rasterizeStl(triangles, { size: 320 });
      canvas.width = raster.width;
      canvas.height = raster.height;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.putImageData(new ImageData(new Uint8ClampedArray(raster.data), raster.width, raster.height), 0, 0);
      setFailure("");
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Could not render this STL.");
    }
  }, [data]);

  if (failure) return <p className="app-muted">Preview unavailable: {failure}</p>;
  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      style={{ width: "100%", maxWidth: 320, height: "auto", borderRadius: "var(--radius-sm, 12px)", border: "1px solid var(--line)" }}
    />
  );
}

/** On-demand preview of a stored version: canvas render <=20 MB, stored thumbnail above. */
function StoredVersionPreview({ version }: { version: CadVersionSummary }) {
  const [state, setState] = useState<"idle" | "loading" | "shown" | "failed">("idle");
  const [bytes, setBytes] = useState<Uint8Array | null>(null);

  if (version.format !== "stl") return null;

  if (version.byteSize > MAX_INLINE_PREVIEW_BYTES) {
    return version.hasThumbnail ? (
      <figure style={{ margin: 0 }}>
        <img
          src={`/api/cad-vault/file/${version.publicId}/thumbnail`}
          alt={`Server-rendered thumbnail of ${version.filename}`}
          width={220}
          height={220}
          style={{ maxWidth: "100%", height: "auto", borderRadius: "var(--radius-sm, 12px)", border: "1px solid var(--line)" }}
        />
        <figcaption className="app-muted">
          <small>{formatBytes(version.byteSize)} — too large for the live preview; showing the stored thumbnail.</small>
        </figcaption>
      </figure>
    ) : (
      <p className="app-muted">
        <small>{formatBytes(version.byteSize)} is above the 20 MB live-preview limit and no thumbnail was rendered.</small>
      </p>
    );
  }

  if (state === "idle" || state === "loading") {
    return (
      <Button variant="secondary" type="button" disabled={state === "loading"} onClick={() => { setState("loading"); void fetch(`/api/cad-vault/file/${version.publicId}`) .then(async (response) => { if (!response.ok) throw new Error("download failed"); const buffer = await response.arrayBuffer(); setBytes(new Uint8Array(buffer)); setState("shown"); }) .catch(() => setState("failed")); }}>
        {state === "loading" ? "Loading model…" : "Preview 3D"}
      </Button>
    );
  }
  if (state === "failed") return <p className="app-muted">Could not load the model for preview.</p>;
  return bytes ? <StlCanvas data={bytes} label={`Isometric preview of ${version.filename}`} /> : null;
}

function GeometrySummary({ version }: { version: CadVersionSummary }) {
  const summary = readGeometry(version.geometry);
  if (!summary) {
    return (
      <p className="app-muted" style={{ margin: 0 }}>
        <small>
          No geometry summary for this format — only STL is parsed server-side; {version.format.toUpperCase()} files are
          stored byte-for-byte without tessellation.
        </small>
      </p>
    );
  }
  return (
    <p className="app-muted" style={{ margin: 0 }}>
      <small>
        {formatNumber(summary.triangleCount)} triangles
        {summary.dims ? ` · bbox ${summary.dims.map((d) => formatNumber(d)).join(" × ")}` : ""}
        {summary.volume != null ? ` · volume ${formatNumber(summary.volume)}` : ""}
        {summary.surfaceArea != null ? ` · surface ${formatNumber(summary.surfaceArea)}` : ""}
        {summary.degenerate ? ` · ${formatNumber(summary.degenerate)} degenerate` : ""}
        {" — in the file's own units (STL carries none)"}
      </small>
    </p>
  );
}

type PendingUpload = {
  file: File;
  bytes: Uint8Array;
  format: CadFormat;
};

export default function CadVaultClient() {
  const [view, setView] = useState<CadVaultView | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [seasonYear, setSeasonYear] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const viewRef = useRef<CadVaultView | null>(null);
  viewRef.current = view;

  // Upload panel state — everything stays in this one panel.
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
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setFetchFailed(true);
        return;
      }
      if (!response.ok || !isCadVaultView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh CAD Vault. Showing the last copy on this device.");
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
        setError("Could not refresh CAD Vault. Showing the last copy on this device.");
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

  const description =
    "Versioned storage for STL, STEP, and vendor CAD files — bytes verified by magic numbers, linked to robot subsystems. Not a CAD editor: no Onshape sync and no STEP/IGES tessellation.";

  if (!view) {
    return (
      <main className="module-page cad-vault-page">
        <PageHeader breadcrumbs={<><a href="/build">Build</a>{" / CAD Vault"}</>} title="CAD Vault" description={description} />
        <OfflineBanner feature="CAD Vault" fromCache={fromCache} cachedAt={cachedAt} />
        {fetchFailed ? (
          <EmptyState soft badge="Unavailable" badgeTone="setup" title="Could not load the CAD vault" description="Check your connection and try again.">
            <Button variant="secondary" type="button" onClick={() => void load(seasonYear)}>
              Retry
            </Button>
          </EmptyState>
        ) : (
          <EmptyState soft badge="Loading" badgeTone="setup" title="Loading the vault…" description="Fetching your team's documents." aria-busy />
        )}
      </main>
    );
  }

  if (view.status === "setup_required") {
    return (
      <main className="module-page cad-vault-page soft-gate">
        <PageHeader breadcrumbs={<><a href="/build">Build</a>{" / CAD Vault"}</>} title="CAD Vault" description={description} />
        <OfflineBanner feature="CAD Vault" fromCache={fromCache} cachedAt={cachedAt} />
        {error ? (
          <p className="telemetry-status" role="alert">
            {error}
          </p>
        ) : null}
        <EmptyState soft badge="Setup required" badgeTone="setup" title="Choose your team" description={view.message}>
          {view.steps[0] ? (
            <Button as="a" variant="primary" href={view.steps[0].href}>
              {view.steps[0].label}
            </Button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  const documents = ready?.documents ?? [];
  const subsystems = ready?.subsystems ?? [];
  const seasons = ready?.seasons ?? [];

  return (
    <main className="module-page cad-vault-page">
      <PageHeader
        breadcrumbs={<><a href={withOrgHref("/build", orgId)}>Build</a>{" / CAD Vault"}</>}
        title="CAD Vault"
        description={description}
      >
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
      </PageHeader>
      <OfflineBanner feature="CAD Vault" fromCache={fromCache} cachedAt={cachedAt} />

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
        {orgId ? (
          <LinkOnshapePanel
            orgId={orgId}
            seasonYear={seasonYear}
            subteams={ready?.subsystems ?? []}
            busy={busy}
            onCreated={(title) => {
              setNotice(`Linked "${title}".`);
              load(seasonYear);
            }}
          />
        ) : null}
        <Panel aria-label="Upload a CAD file" style={{ display: "grid", gap: 12 }}>
          <h2 style={{ margin: 0 }}>Upload</h2>
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
                  <small>STL · STEP · IGES · 3MF · OBJ · DXF · PDF · SolidWorks · Inventor · Fusion · ZIP — up to 50 MB. The bytes are verified, not the extension.</small>
                </span>
              </>
            )}
          </div>

          {pending ? (
            <>
              <FormGrid min={180}>
                <FormRow label="Add to">
                  <select
                    value={targetDocumentId}
                    onChange={(event) => setTargetDocumentId(event.target.value)}
                    disabled={busy}
                  >
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

        {documents.length === 0 ? (
          <EmptyState
            soft
            badge="No documents yet"
            badgeTone="setup"
            title="Your vault is empty"
            description="Upload your first STL, STEP, or vendor file above. Only your team can see what you put here."
          />
        ) : (
          documents.map((doc) => (
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
          ))
        )}

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

function DocumentCard({
  doc,
  subsystems,
  busy,
  onPatch,
  onRestore,
  onUploadVersion,
}: {
  doc: CadDocumentSummary;
  subsystems: SubsystemOption[];
  busy: boolean;
  onPatch: (documentId: string, payload: Record<string, unknown>) => void;
  onRestore: (documentId: string, version: number) => void;
  onUploadVersion: (documentId: string) => void;
}) {
  const [showVersions, setShowVersions] = useState(false);
  const latest = doc.latest;

  return (
    <Panel aria-label={`Document ${doc.title}`} style={{ display: "grid", gap: 10, opacity: doc.status === "archived" ? 0.72 : 1 }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div>
          <h2 style={{ margin: 0 }}>{doc.title}</h2>
          <p className="app-muted" style={{ margin: "4px 0 0" }}>
            <span className="app-badge">{cadKindLabel(doc.kind)}</span>{" "}
            {doc.status !== "active" ? <span className="app-badge setup">{doc.status}</span> : null}{" "}
            <small>
              {doc.subsystemName ?? "No subsystem"} · v{doc.currentVersion} · {formatBytes(doc.totalBytes)} across {doc.versions.length} version
              {doc.versions.length === 1 ? "" : "s"}
            </small>
          </p>
          {doc.description ? (
            <p className="app-muted" style={{ margin: "4px 0 0" }}>
              <small>{doc.description}</small>
            </p>
          ) : null}
          {doc.externalUrl ? (
            <p style={{ margin: "4px 0 0" }}>
              <small>
                <a href={doc.externalUrl} target="_blank" rel="noreferrer noopener">
                  External source link
                </a>
              </small>
            </p>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {latest ? (
            <Button as="a" variant="secondary" href={`/api/cad-vault/file/${latest.publicId}`}>
              Download v{latest.version}
            </Button>
          ) : null}
          <Button variant="secondary" type="button" disabled={busy} onClick={() => onUploadVersion(doc.id)}>
            New version
          </Button>
        </div>
      </header>

      {latest ? (
        <div style={{ display: "grid", gap: 8 }}>
          <p className="app-muted" style={{ margin: 0 }}>
            <small>
              Latest: {latest.filename} · {latest.format.toUpperCase()} · {formatBytes(latest.byteSize)}
              {latest.changeNote ? ` · “${latest.changeNote}”` : ""}
            </small>
          </p>
          <GeometrySummary version={latest} />
          <StoredVersionPreview version={latest} />
        </div>
      ) : (
        <p className="app-muted" style={{ margin: 0 }}>
          <small>No file uploaded yet — this document is an empty shell.</small>
        </p>
      )}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <small>Subsystem</small>
          <select
            value={doc.subsystemId ?? ""}
            disabled={busy}
            onChange={(event) => onPatch(doc.id, { subsystemId: event.target.value || null })}
          >
            <option value="">Unassigned</option>
            {subsystems.map((subsystem) => (
              <option key={subsystem.id} value={subsystem.id}>
                {subsystem.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => {
            const next = window.prompt("Rename document", doc.title);
            if (next && next.trim() && next.trim() !== doc.title) onPatch(doc.id, { title: next.trim() });
          }}
        >
          Rename
        </button>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => onPatch(doc.id, { status: doc.status === "archived" ? "active" : "archived" })}
        >
          {doc.status === "archived" ? "Unarchive" : "Archive"}
        </button>
        {doc.versions.length > 0 ? (
          <button type="button" className="text-button" onClick={() => setShowVersions((prev) => !prev)}>
            {showVersions ? "Hide versions" : `Versions (${doc.versions.length})`}
          </button>
        ) : null}
      </div>

      {showVersions ? (
        <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }} aria-label={`Versions of ${doc.title}`}>
          {doc.versions.map((version) => (
            <li
              key={version.publicId}
              style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center", borderTop: "1px solid var(--line)", paddingTop: 8 }}
            >
              <div>
                <strong>v{version.version}</strong>{" "}
                <span className="app-muted">
                  <small>
                    {version.filename} · {version.format.toUpperCase()} · {formatBytes(version.byteSize)} ·{" "}
                    {new Date(version.createdAt).toLocaleString()}
                  </small>
                </span>
                {version.changeNote ? (
                  <p className="app-muted" style={{ margin: "2px 0 0" }}>
                    <small>“{version.changeNote}”</small>
                  </p>
                ) : null}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <Button as="a" variant="secondary" href={`/api/cad-vault/file/${version.publicId}`}>
                  Download
                </Button>
                {version.version !== doc.currentVersion ? (
                  <Button variant="secondary" type="button" disabled={busy} onClick={() => onRestore(doc.id, version.version)}>
                    Restore as new version
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </Panel>
  );
}
