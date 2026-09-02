"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { uploadPhotoToLibrary } from "../../lib/media-library/browser-prepare";
import { BUILD_PHASE_LABEL, BUILD_PHASES, type BuildPhase, type NotebookMedia } from "../../lib/notebook";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import "./notebook.css";

type Entry = {
  id: string; seasonYear: number; entryDate: string; phase: BuildPhase; subsystem: string;
  title: string; body: string; tags: string[]; byName: string | null; updatedAt: string;
  media: NotebookMedia[];
};
type View =
  | { status: "setup_required"; message: string }
  | { status: "ready"; context: { orgId: string; role: string }; entries: Entry[]; summary: { total: number; subsystems: { name: string; count: number }[]; phases: { phase: BuildPhase; count: number }[]; lastEntryOn: string | null } };

type Lightbox = { src: string; title: string } | null;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function NotebookClient({ orgId }: { orgId: string | null }) {
  const seasonYear = new Date().getFullYear();
  const [view, setView] = useState<View | null>(null);
  const [message, setMessage] = useState("");
  // Kept so an expired session offers sign-in instead of a dead-end error line.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [subsystemFilter, setSubsystemFilter] = useState("");
  const [form, setForm] = useState({ title: "", entryDate: todayIso(), phase: "design", subsystem: "", tags: "", body: "" });
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<Lightbox>(null);
  // Print view swaps thumbnails for full-size images, then prints once they load.
  const [printMode, setPrintMode] = useState(false);
  const printTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (orgId) params.set("orgId", orgId);
    if (subsystemFilter) params.set("subsystem", subsystemFilter);
    const response = await fetch(`/api/notebook${params.toString() ? `?${params}` : ""}`);
    const data = (await response.json()) as View & { error?: string };
    if (!response.ok) { setMessage(data.error ?? "Failed to load notebook"); setErrorStatus(response.status); return; }
    setErrorStatus(null);
    setView(data);
  }, [orgId, subsystemFilter]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  useEffect(() => {
    if (!printMode) return;
    const images = Array.from(document.querySelectorAll<HTMLImageElement>(".nb-print-image"));
    const pending = images.filter((image) => !image.complete);
    let cancelled = false;
    const go = () => {
      if (cancelled) return;
      window.print();
    };
    const onAfter = () => setPrintMode(false);
    window.addEventListener("afterprint", onAfter);
    if (pending.length === 0) {
      printTimer.current = window.setTimeout(go, 50);
    } else {
      let left = pending.length;
      const done = () => {
        left -= 1;
        if (left === 0) go();
      };
      for (const image of pending) {
        image.addEventListener("load", done, { once: true });
        image.addEventListener("error", done, { once: true });
      }
      // Never hang the print on a slow image.
      printTimer.current = window.setTimeout(go, 4000);
    }
    return () => {
      cancelled = true;
      window.removeEventListener("afterprint", onAfter);
      if (printTimer.current) window.clearTimeout(printTimer.current);
    };
  }, [printMode]);

  async function post(body: Record<string, unknown>, okMessage: string): Promise<{ ok: boolean; id?: string }> {
    if (view?.status !== "ready") return { ok: false };
    const response = await fetch("/api/notebook", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: view.context.orgId, ...body }),
    });
    const data = (await response.json()) as { id?: string; error?: string };
    setMessage(response.ok ? okMessage : (data.error ?? "Request failed"));
    if (response.ok) await load();
    return { ok: response.ok, id: data.id };
  }

  /** Upload through the media library, then link each item to the entry. */
  async function attachFiles(entryId: string, files: File[]) {
    if (view?.status !== "ready" || !files.length) return;
    setUploadingFor(entryId);
    let attached = 0;
    let failed = "";
    for (const file of files) {
      try {
        const uploaded = await uploadPhotoToLibrary({ orgId: view.context.orgId, file, subteam: null });
        const response = await fetch("/api/notebook", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId: view.context.orgId, action: "attach_media", id: entryId, mediaItemId: uploaded.itemId }),
        });
        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          failed = data.error ?? "Could not attach photo.";
          continue;
        }
        attached += 1;
      } catch (error) {
        failed = error instanceof Error ? error.message : "Upload failed.";
      }
    }
    setUploadingFor(null);
    setMessage(
      failed
        ? `${attached ? `${attached} photo(s) attached. ` : ""}${failed}`
        : `${attached} photo${attached === 1 ? "" : "s"} attached.`,
    );
    await load();
  }

  async function addEntry(event: React.FormEvent) {
    event.preventDefault();
    const created = await post({ action: "create_entry", seasonYear, ...form }, "Entry added.");
    if (!created.ok) return;
    setForm({ title: "", entryDate: todayIso(), phase: "design", subsystem: "", tags: "", body: "" });
    if (created.id && pendingFiles.length) {
      const files = pendingFiles;
      setPendingFiles([]);
      await attachFiles(created.id, files);
    }
  }

  if (!view) {
    if (!message) return <main className="intel-app"><p className="telemetry-status">Loading notebook…</p></main>;
    // The notebook never loaded: say why, and offer the action that actually fixes it.
    const copy = loadFailureCopy(
      classifyLoadFailure({
        status: errorStatus,
        message,
        online: typeof navigator === "undefined" ? true : navigator.onLine,
      }),
      {
        nextPath:
          typeof window === "undefined"
            ? null
            : `${window.location.pathname}${window.location.search}`,
        message,
      },
    );
    return (
      <main className="intel-app">
        <p className="telemetry-status"><strong>{copy.title}</strong></p>
        <p className="telemetry-status">{copy.description}</p>
        {copy.primary ? <a className="app-button" href={copy.primary.href}>{copy.primary.label}</a> : null}
        {copy.showRetry ? <button type="button" className="primary-action" onClick={() => void load()}>Retry</button> : null}
      </main>
    );
  }
  if (view.status === "setup_required") {
    return <main className="intel-app"><header className="intel-header"><div><span className="eyebrow">VANTAGE / NOTEBOOK</span><h1>Engineering notebook</h1></div></header><p className="telemetry-status">{view.message}</p></main>;
  }

  const canWrite = view.context.role !== "viewer";

  return (
    <main className={`intel-app nb-page${printMode ? " nb-print" : ""}`}>
      <header className="intel-header nb-no-print">
        <div><span className="eyebrow">VANTAGE / NOTEBOOK</span><h1>Engineering &amp; build notebook</h1></div>
        <nav className="intel-actions">
          <button type="button" className="nb-link-button" onClick={() => setPrintMode(true)}>Print / export</button>
          <a href={`/impact${orgId ? `?orgId=${orgId}` : ""}`}>Impact</a>
          <a href={`/team/awards${orgId ? `?orgId=${orgId}` : ""}`}>Awards</a>
          <a href="/workspace">Workspace →</a>
        </nav>
      </header>
      <header className="nb-print-only nb-print-head">
        <h1>Engineering notebook · {seasonYear}</h1>
        <p>{view.summary.total} entr{view.summary.total === 1 ? "y" : "ies"}{subsystemFilter ? ` · ${subsystemFilter}` : ""} · printed {new Date().toLocaleDateString()}</p>
      </header>
      {message && <p className="telemetry-status nb-no-print">{message}</p>}

      <section className="metric-grid nb-no-print">
        <article><span>Entries</span><strong>{view.summary.total}</strong></article>
        <article><span>Subsystems documented</span><strong>{view.summary.subsystems.length}</strong></article>
        <article><span>Last entry</span><strong>{view.summary.lastEntryOn ? new Date(view.summary.lastEntryOn).toLocaleDateString() : "—"}</strong></article>
        <article><span>Season</span><strong>{seasonYear}</strong></article>
      </section>

      <section className="admin-grid nb-no-print">
        <form className="intel-panel" onSubmit={addEntry}>
          <span className="eyebrow">NEW NOTEBOOK ENTRY</span>
          <label>Title<input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Intake roller prototype #2" /></label>
          <div className="budget-fields">
            <label>Date<input type="date" value={form.entryDate} onChange={(e) => setForm({ ...form, entryDate: e.target.value })} /></label>
            <label>Phase<select value={form.phase} onChange={(e) => setForm({ ...form, phase: e.target.value })}>{BUILD_PHASES.map((p) => <option key={p} value={p}>{BUILD_PHASE_LABEL[p]}</option>)}</select></label>
          </div>
          <div className="budget-fields">
            <label>Subsystem<input value={form.subsystem} onChange={(e) => setForm({ ...form, subsystem: e.target.value })} placeholder="Intake" /></label>
            <label>Tags (comma-separated)<input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="cad, test" /></label>
          </div>
          <label>What did you decide / learn?<textarea rows={4} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></label>
          <label>
            Photos (optional)
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(e) => setPendingFiles(Array.from(e.target.files ?? []))}
            />
            {pendingFiles.length ? <small>{pendingFiles.length} photo{pendingFiles.length === 1 ? "" : "s"} will upload to the media library and attach to this entry.</small> : null}
          </label>
          <button className="primary-action" disabled={uploadingFor != null}>Add entry</button>
        </form>
        <section className="intel-panel">
          <span className="eyebrow">SUBSYSTEMS</span>
          <p><a href="#" onClick={(e) => { e.preventDefault(); setSubsystemFilter(""); }}>{subsystemFilter ? "Show all" : "All subsystems"}</a></p>
          {view.summary.subsystems.map((s) => (
            <article key={s.name} onClick={() => setSubsystemFilter(s.name === "General" ? "" : s.name)} style={{ cursor: "pointer" }}>
              <div><strong>{s.name}</strong><small>{s.count} {s.count === 1 ? "entry" : "entries"}</small></div>
            </article>
          ))}
          {view.summary.phases.length > 0 && (
            <p><small>{view.summary.phases.map((p) => `${BUILD_PHASE_LABEL[p.phase]}: ${p.count}`).join(" · ")}</small></p>
          )}
        </section>
      </section>

      <section className="intel-panel invite-list nb-entries">
        <span className="eyebrow nb-no-print">{subsystemFilter ? `${subsystemFilter.toUpperCase()} ENTRIES` : "ALL ENTRIES"}</span>
        {view.entries.length === 0 && <p>No entries yet — document your first design decision above.</p>}
        {view.entries.map((entry) => (
          <article key={entry.id} className="nb-entry">
            <div style={{ flex: 1 }}>
              <strong>{entry.title}</strong>
              <small>{new Date(entry.entryDate).toLocaleDateString()} · {BUILD_PHASE_LABEL[entry.phase]}{entry.subsystem ? ` · ${entry.subsystem}` : ""}{entry.byName ? ` · ${entry.byName}` : ""}{entry.tags.length ? ` · ${entry.tags.map((t) => `#${t}`).join(" ")}` : ""}</small>
              {entry.body && <small style={{ whiteSpace: "pre-wrap" }}>{entry.body}</small>}
              {entry.media.length > 0 ? (
                <div className="nb-media" aria-label="Attached photos">
                  {entry.media.map((item) => (
                    <figure key={item.itemId} className="nb-media-item">
                      {printMode ? (
                        <img className="nb-print-image" src={item.src} alt={item.title} />
                      ) : (
                        <button
                          type="button"
                          className="nb-thumb"
                          title={item.title}
                          onClick={() => setLightbox({ src: item.src, title: item.title })}
                        >
                          <img src={item.thumbnailSrc ?? item.src} alt={item.title} loading="lazy" />
                        </button>
                      )}
                      <figcaption>
                        {item.title}
                        {canWrite && !printMode ? (
                          <button
                            type="button"
                            className="nb-link-button nb-no-print"
                            disabled={uploadingFor != null}
                            onClick={() => void post({ action: "detach_media", id: entry.id, mediaItemId: item.itemId }, "Photo detached (it stays in the media library).")}
                          >
                            Remove
                          </button>
                        ) : null}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              ) : null}
              {canWrite ? (
                <label className="nb-upload nb-no-print">
                  {uploadingFor === entry.id ? "Uploading…" : "Add photo"}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    hidden
                    disabled={uploadingFor != null}
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      e.target.value = "";
                      void attachFiles(entry.id, files);
                    }}
                  />
                </label>
              ) : null}
            </div>
            {canWrite && <button className="nb-no-print" onClick={() => void post({ action: "delete_entry", id: entry.id }, "Entry deleted.")}>Delete</button>}
          </article>
        ))}
      </section>

      {lightbox ? (
        <div className="nb-lightbox" role="dialog" aria-modal="true" aria-label={lightbox.title} onClick={() => setLightbox(null)}>
          <figure onClick={(e) => e.stopPropagation()}>
            <img src={lightbox.src} alt={lightbox.title} />
            <figcaption>
              {lightbox.title}
              <a href={lightbox.src} target="_blank" rel="noopener noreferrer">Open full size</a>
              <button type="button" className="nb-link-button" onClick={() => setLightbox(null)}>Close</button>
            </figcaption>
          </figure>
        </div>
      ) : null}
    </main>
  );
}
