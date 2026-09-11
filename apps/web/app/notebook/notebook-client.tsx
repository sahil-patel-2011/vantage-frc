"use client";
import { Button, EmptyState } from "../../components/ui";
import { useCallback, useEffect, useState } from "react";
import { BUILD_PHASE_LABEL, BUILD_PHASES, type BuildPhase } from "../../lib/notebook";
import type { NotebookImageAttachment } from "../../lib/notebook/attachments";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type Entry = {
  id: string; seasonYear: number; entryDate: string; phase: BuildPhase; subsystem: string;
  title: string; body: string; tags: string[]; byName: string | null; updatedAt: string;
  attachments: NotebookImageAttachment[]; hasImageEvidence: boolean;
};
type View =
  | { status: "setup_required"; message: string }
  | {
      status: "ready";
      context: { orgId: string; role: string };
      entries: Entry[];
      imageLibrary: NotebookImageAttachment[];
      summary: {
        total: number;
        subsystems: { name: string; count: number }[];
        phases: { phase: BuildPhase; count: number }[];
        lastEntryOn: string | null;
        withPhotos: number;
        missingPhotos: number;
      };
    };

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function orgQuery(orgId: string | null) {
  return orgId ? `?orgId=${orgId}` : "";
}

/** Resolved cite only — never a placeholder URL or invented poster. */
function CiteMedia({
  asset,
  compact,
}: {
  asset: NotebookImageAttachment;
  compact?: boolean;
}) {
  const url = asset.url.trim();
  if (!url) return null;
  const style = compact
    ? { width: "100%", height: 80, objectFit: "cover" as const }
    : { maxWidth: 220, maxHeight: 160, objectFit: "cover" as const };
  if (asset.kind === "video") {
    return (
      <video
        src={url}
        controls
        playsInline
        preload="metadata"
        style={style}
        aria-label={asset.title}
      />
    );
  }
  return <img src={url} alt={asset.title} style={style} />;
}

export default function NotebookClient({ orgId }: { orgId: string | null }) {
  const seasonYear = new Date().getFullYear();
  const [view, setView] = useState<View | null>(null);
  const [message, setMessage] = useState("");
  // Kept so an expired session offers sign-in instead of a dead-end error line.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [subsystemFilter, setSubsystemFilter] = useState("");
  const [form, setForm] = useState({ title: "", entryDate: todayIso(), phase: "design", subsystem: "", tags: "", body: "", attachmentIds: [] as string[] });
  const [entryPhotos, setEntryPhotos] = useState<Record<string, string[]>>({});

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (orgId) params.set("orgId", orgId);
    if (subsystemFilter) params.set("subsystem", subsystemFilter);
    const response = await fetch(`/api/notebook${params.toString() ? `?${params}` : ""}`);
    const data = (await response.json()) as View & { error?: string };
    if (!response.ok) { setMessage(data.error ?? "Failed to load notebook"); setErrorStatus(response.status); return; }
    setErrorStatus(null);
    setView(data);
    setEntryPhotos({});
  }, [orgId, subsystemFilter]);
  useEffect(() => { void load(); }, [load]);

  async function post(body: Record<string, unknown>, okMessage: string) {
    if (view?.status !== "ready") return;
    const response = await fetch("/api/notebook", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: view.context.orgId, ...body }),
    });
    const data = await response.json();
    setMessage(response.ok ? okMessage : data.error);
    if (response.ok) await load();
  }

  // Promotion is idempotent, so pressing this twice is safe — but say which happened rather than
  // reporting "added" when the page was already there.
  async function promoteEntry(id: string) {
    if (view?.status !== "ready") return;
    const response = await fetch("/api/notebook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: view.context.orgId, action: "promote_entry", id }),
    });
    const data = (await response.json()) as { error?: string; slug?: string; alreadyPromoted?: boolean };
    if (!response.ok) {
      setMessage(data.error ?? "Could not add this entry to the wiki.");
      return;
    }
    setMessage(
      data.alreadyPromoted
        ? "This entry is already in the team wiki."
        : "Added to the team wiki.",
    );
  }

  async function addEntry(event: React.FormEvent) {
    event.preventDefault();
    await post(
      { action: "create_entry", seasonYear, ...form, attachments: form.attachmentIds },
      form.attachmentIds.length ? "Entry added." : "Entry added without a photo or video — judged award evidence still needs a real image or clip.",
    );
    if (view?.status === "ready") setForm({ title: "", entryDate: todayIso(), phase: "design", subsystem: "", tags: "", body: "", attachmentIds: [] });
  }

  function toggleFormPhoto(assetId: string) {
    setForm((current) => {
      const has = current.attachmentIds.includes(assetId);
      return {
        ...current,
        attachmentIds: has
          ? current.attachmentIds.filter((id) => id !== assetId)
          : [...current.attachmentIds, assetId],
      };
    });
  }

  function photosFor(entry: Entry) {
    return entryPhotos[entry.id] ?? entry.attachments.map((asset) => asset.assetId);
  }

  function toggleEntryPhoto(entry: Entry, assetId: string) {
    setEntryPhotos((current) => {
      const selected = current[entry.id] ?? entry.attachments.map((asset) => asset.assetId);
      const next = selected.includes(assetId)
        ? selected.filter((id) => id !== assetId)
        : [...selected, assetId];
      return { ...current, [entry.id]: next };
    });
  }

  async function saveEntryPhotos(entry: Entry) {
    await post(
      { action: "update_entry", id: entry.id, attachments: photosFor(entry) },
      photosFor(entry).length ? "Photos and video attached." : "Attachment removed. This entry has no image or video evidence.",
    );
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
        {copy.primary ? <Button as="a" variant="primary" href={copy.primary.href}>{copy.primary.label}</Button> : null}
        {copy.showRetry ? <button type="button" className="primary-action" onClick={() => void load()}>Retry</button> : null}
      </main>
    );
  }
  if (view.status === "setup_required") {
    return (
      <main className="intel-app">
        <header className="intel-header">
          <div>
            <span className="eyebrow">VANTAGE / NOTEBOOK</span>
            <h1>Engineering notebook</h1>
          </div>
        </header>
        <EmptyState badge="Setup required" badgeTone="setup" soft title="Choose your team" description={view.message}>
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
      </main>
    );
  }

  return (
    <main className="intel-app">
      <header className="intel-header">
        <div><span className="eyebrow">VANTAGE / NOTEBOOK</span><h1>Engineering &amp; build notebook</h1></div>
        <nav className="intel-actions"><a href={`/impact${orgQuery(orgId)}`}>Impact</a><a href={`/team/awards${orgQuery(orgId)}`}>Awards</a><a href="/workspace">Your team →</a></nav>
      </header>
      {message && <p className="telemetry-status">{message}</p>}
      {view.summary.missingPhotos > 0 && (
        <p className="telemetry-status">
          {view.summary.missingPhotos === 1
            ? "1 entry has no photo or video. Text alone is not enough for judged award evidence."
            : `${view.summary.missingPhotos} entries have no photo or video. Text alone is not enough for judged award evidence.`}
        </p>
      )}

      <section className="metric-grid">
        <article><span>Entries</span><strong>{view.summary.total}</strong></article>
        <article><span>With photos</span><strong>{view.summary.withPhotos}</strong></article>
        <article><span>Last entry</span><strong>{view.summary.lastEntryOn ? new Date(view.summary.lastEntryOn).toLocaleDateString() : "—"}</strong></article>
        <article><span>Season</span><strong>{seasonYear}</strong></article>
      </section>

      <section className="admin-grid">
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
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="eyebrow">PHOTOS &amp; VIDEO</legend>
            {view.imageLibrary.length === 0 ? (
              <p>
                No photos or videos in the media library or pit scouting yet — a text write-up is not award evidence.{" "}
                <a href={`/media-library${orgQuery(orgId)}`}>Add a real photo or video in Media library</a>
                {" "}or{" "}
                <a href={`/scouting${orgQuery(orgId)}`}>pit scouting</a>.
              </p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8 }}>
                {view.imageLibrary.map((asset) => (
                  <label key={asset.assetId} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <CiteMedia asset={asset} compact />
                    <span>
                      <input
                        type="checkbox"
                        checked={form.attachmentIds.includes(asset.assetId)}
                        onChange={() => toggleFormPhoto(asset.assetId)}
                      />{" "}
                      {asset.title}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          <button className="primary-action">Add entry</button>
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

      <section className="intel-panel invite-list">
        <span className="eyebrow">{subsystemFilter ? `${subsystemFilter.toUpperCase()} ENTRIES` : "ALL ENTRIES"}</span>
        {view.entries.length === 0 && <p>No entries yet — document your first design decision above.</p>}
        {view.entries.map((entry) => (
          <article key={entry.id}>
            <div style={{ flex: 1 }}>
              <strong>{entry.title}</strong>
              <small>{new Date(entry.entryDate).toLocaleDateString()} · {BUILD_PHASE_LABEL[entry.phase]}{entry.subsystem ? ` · ${entry.subsystem}` : ""}{entry.byName ? ` · ${entry.byName}` : ""}{entry.tags.length ? ` · ${entry.tags.map((t) => `#${t}`).join(" ")}` : ""}</small>
              {entry.body && <small style={{ whiteSpace: "pre-wrap" }}>{entry.body}</small>}
              {entry.attachments.length === 0 ? (
                <small>No photo or video attached — judged award evidence needs a real image or clip, not just this write-up.</small>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                  {entry.attachments.map((asset) => (
                    <figure key={asset.assetId} style={{ margin: 0 }}>
                      <CiteMedia asset={asset} />
                      <figcaption><small>{asset.title}</small></figcaption>
                    </figure>
                  ))}
                </div>
              )}
              {view.context.role !== "viewer" && (
                <details style={{ marginTop: 8 }}>
                  <summary>Attach photos or video</summary>
                  {view.imageLibrary.length === 0 ? (
                    <p>
                      Nothing to attach until a real photo or video is in the{" "}
                      <a href={`/media-library${orgQuery(orgId)}`}>Media library</a>
                      {" "}or{" "}
                      <a href={`/scouting${orgQuery(orgId)}`}>pit scouting</a>.
                    </p>
                  ) : (
                    <>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8, marginTop: 8 }}>
                        {view.imageLibrary.map((asset) => (
                          <label key={asset.assetId} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <CiteMedia asset={asset} compact />
                            <span>
                              <input
                                type="checkbox"
                                checked={photosFor(entry).includes(asset.assetId)}
                                onChange={() => toggleEntryPhoto(entry, asset.assetId)}
                              />{" "}
                              {asset.title}
                            </span>
                          </label>
                        ))}
                      </div>
                      <button type="button" onClick={() => void saveEntryPhotos(entry)}>Save photos &amp; video</button>
                    </>
                  )}
                </details>
              )}
            </div>
            {view.context.role !== "viewer" && (
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  title="Copy this entry into the team wiki so it outlives the season"
                  onClick={() => void promoteEntry(entry.id)}
                >
                  Send to wiki
                </button>
                <button onClick={() => void post({ action: "delete_entry", id: entry.id }, "Entry deleted.")}>Delete</button>
              </div>
            )}
          </article>
        ))}
      </section>
    </main>
  );
}
