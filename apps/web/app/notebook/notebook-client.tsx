"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { Button, EmptyState, FormGrid, FormRow, PageHeader, Panel, StatTile } from "../../components/ui";
import { BUILD_PHASE_LABEL, BUILD_PHASES, type BuildPhase } from "../../lib/notebook";
import type { NotebookImageAttachment } from "../../lib/notebook/attachments";
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { withOrgHref } from "../../lib/nav/product-nav";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type Entry = {
  id: string;
  seasonYear: number;
  entryDate: string;
  phase: BuildPhase;
  subsystem: string;
  title: string;
  body: string;
  tags: string[];
  byName: string | null;
  updatedAt: string;
  attachments: NotebookImageAttachment[];
  hasImageEvidence: boolean;
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

function isNotebookView(value: unknown): value is View {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "ready";
}

function notebookCacheOrg(data: View, orgHint: string): string {
  switch (data.status) {
    case "setup_required":
      return orgHint;
    case "ready":
      return data.context.orgId.trim() || orgHint;
    default: {
      data satisfies never;
      return orgHint;
    }
  }
}

async function persistNotebookSnapshot(orgHint: string, seasonHint: string, data: View): Promise<void> {
  const cacheOrg = notebookCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("notebook", cacheOrg, data, seasonHint);
    if (!orgHint) await putFeatureSnapshot("notebook", "_", data, seasonHint);
  } catch {
    // Live Engineering notebook already painted; IndexedDB is best-effort.
  }
}

function CiteMedia({ asset, compact }: { asset: NotebookImageAttachment; compact?: boolean }) {
  const url = asset.url.trim();
  if (!url) return null;
  const style = compact
    ? { width: "100%", height: 80, objectFit: "cover" as const }
    : { maxWidth: 220, maxHeight: 160, objectFit: "cover" as const };
  if (asset.kind === "video") {
    return <video src={url} controls playsInline preload="metadata" style={style} aria-label={asset.title} />;
  }
  return <img src={url} alt={asset.title} style={style} />;
}

function NotebookRelated({ orgId }: { orgId?: string | null }) {
  return (
    <nav className="product-hub-related" aria-label="Related playbook tools">
      <Button as="a" variant="secondary" href={hubHref("/team", "files", orgId)}>
        Files
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/team", "writer", orgId)}>
        Writer
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/business", "impact", orgId)}>
        Community Impact
      </Button>
    </nav>
  );
}

function NotebookNextActions({ orgId }: { orgId: string }) {
  const actions = [
    {
      id: "entry",
      label: "Add an entry",
      detail: "Date, phase, and a real photo or video — text alone is not award evidence.",
      href: "#notebook-entry",
      primary: true,
    },
    {
      id: "media",
      label: "Open Media library",
      detail: "Attach photos and clips that already exist on the team.",
      href: withOrgHref("/media-library", orgId),
      primary: false,
    },
    {
      id: "files",
      label: "Open Files",
      detail: "Approved write-ups live in the team file space.",
      href: hubHref("/team", "files", orgId),
      primary: false,
    },
  ];
  return (
    <section className="app-card soft-panel edc-next-actions" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Each one opens the page where you finish the work.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <Button as="a" variant="secondary" href={action.href}>
              Open
            </Button>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function NotebookClient({ orgId }: { orgId: string | null }) {
  const seasonYear = new Date().getFullYear();
  const [view, setView] = useState<View | null>(null);
  const [message, setMessage] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [subsystemFilter, setSubsystemFilter] = useState("");
  const [form, setForm] = useState({
    title: "",
    entryDate: todayIso(),
    phase: "design" as BuildPhase,
    subsystem: "",
    tags: "",
    body: "",
    attachmentIds: [] as string[],
  });
  const [entryPhotos, setEntryPhotos] = useState<Record<string, string[]>>({});
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<View | null>(null);
  viewRef.current = view;

  const load = useCallback(async () => {
    const orgHint = orgId?.trim() ?? "";
    const seasonHint = String(seasonYear);
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<View>("notebook", orgHint || "_", seasonHint);
      if (!viewRef.current && cached?.data && isNotebookView(cached.data)) {
        setView(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setFetchFailed(false);
    setLoadError("");
    setErrorStatus(null);
    try {
      const params = new URLSearchParams();
      if (orgId) params.set("orgId", orgId);
      if (subsystemFilter) params.set("subsystem", subsystemFilter);
      const response = await fetch(`/api/notebook${params.toString() ? `?${params}` : ""}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setFetchFailed(true);
        setErrorStatus(response.status);
        setLoadError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "",
        );
        return;
      }
      if (!response.ok || !isNotebookView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setMessage("Could not refresh Engineering notebook. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setErrorStatus(response.status);
        setLoadError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "Failed to load notebook",
        );
        return;
      }
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      setMessage("");
      setEntryPhotos({});
      if (!subsystemFilter) await persistNotebookSnapshot(orgHint, seasonHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setMessage("Could not refresh Engineering notebook. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setFetchFailed(true);
    }
  }, [orgId, seasonYear, subsystemFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(body: Record<string, unknown>, okMessage: string) {
    if (view?.status !== "ready") return;
    const response = await fetch("/api/notebook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: view.context.orgId, ...body }),
      signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
    });
    const data = await response.json();
    setMessage(response.ok ? okMessage : data.error);
    if (response.ok) await load();
  }

  async function promoteEntry(id: string) {
    if (view?.status !== "ready") return;
    const response = await fetch("/api/notebook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: view.context.orgId, action: "promote_entry", id }),
      signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
    });
    const data = (await response.json()) as { error?: string; slug?: string; alreadyPromoted?: boolean };
    if (!response.ok) {
      setMessage(data.error ?? "Could not add this entry to the wiki.");
      return;
    }
    setMessage(data.alreadyPromoted ? "This entry is already in the team wiki." : "Added to the team wiki.");
  }

  async function addEntry(event: FormEvent) {
    event.preventDefault();
    await post(
      { action: "create_entry", seasonYear, ...form, attachments: form.attachmentIds },
      form.attachmentIds.length
        ? "Entry added."
        : "Entry added without a photo or video — judged award evidence still needs a real image or clip.",
    );
    if (view?.status === "ready") {
      setForm({ title: "", entryDate: todayIso(), phase: "design", subsystem: "", tags: "", body: "", attachmentIds: [] });
    }
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
      photosFor(entry).length
        ? "Photos and video attached."
        : "Attachment removed. This entry has no image or video evidence.",
    );
  }

  const playbookHref = hubWorkbenchHref("team", "notebook", orgId);
  const mediaHref = withOrgHref("/media-library", orgId);
  const scoutingHref = withOrgHref("/scouting", orgId);

  if (!view) {
    const failure = fetchFailed
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus,
            message: loadError,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: loadError || "A network or server issue prevented loading. Try again.",
          },
        )
      : null;
    return (
      <main className="module-page">
        <PageHeader
          breadcrumbs={
            <>
              <a href={playbookHref}>Team</a>
              {" / Engineering notebook"}
            </>
          }
          title="Engineering notebook"
          description="Dated design decisions with real photos or video."
        >
          <NotebookRelated orgId={orgId} />
        </PageHeader>
        <OfflineBanner feature="Engineering notebook" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          title={failure ? failure.title : "Loading notebook…"}
          description={failure ? failure.description : "Checking your team."}
          aria-busy={!fetchFailed}
        >
          {failure?.primary ? (
            <Button as="a" variant="primary" href={failure.primary.href}>
              {failure.primary.label}
            </Button>
          ) : null}
          {failure?.showRetry ? (
            <Button variant="secondary" type="button" onClick={() => void load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  switch (view.status) {
    case "setup_required":
      return (
        <main className="module-page">
          <PageHeader
            breadcrumbs={
              <>
                <a href={playbookHref}>Team</a>
                {" / Engineering notebook"}
              </>
            }
            title="Engineering notebook"
            description="Dated design decisions with real photos or video."
          >
            <NotebookRelated orgId={orgId} />
          </PageHeader>
          <OfflineBanner feature="Engineering notebook" fromCache={fromCache} cachedAt={cachedAt} />
          <EmptyState badge="Needs setup" badgeTone="setup" title={view.message}>
            <Button as="a" variant="primary" href="/workspace">
              Choose your team
            </Button>
          </EmptyState>
        </main>
      );
    case "ready":
      break;
    default: {
      view satisfies never;
      return null;
    }
  }

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={playbookHref}>Team</a>
            {" / Engineering notebook"}
          </>
        }
        title="Engineering notebook"
        description="Dated design decisions with real photos or video."
      >
        <NotebookRelated orgId={view.context.orgId} />
      </PageHeader>
      <OfflineBanner feature="Engineering notebook" fromCache={fromCache} cachedAt={cachedAt} />
      {message ? (
        <p className="app-muted" role="status">
          {message}
        </p>
      ) : null}
      {view.summary.missingPhotos > 0 ? (
        <p className="app-muted" role="status">
          {view.summary.missingPhotos === 1
            ? "1 entry has no photo or video. Text alone is not enough for judged award evidence."
            : `${view.summary.missingPhotos} entries have no photo or video. Text alone is not enough for judged award evidence.`}
        </p>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
        <StatTile label="Entries" value={view.summary.total} />
        <StatTile label="With photos" value={view.summary.withPhotos} />
        <StatTile
          label="Last entry"
          value={view.summary.lastEntryOn ? new Date(view.summary.lastEntryOn).toLocaleDateString() : "—"}
        />
        <StatTile label="Season" value={seasonYear} />
      </div>

      <Panel as="form" id="notebook-entry" onSubmit={addEntry}>
        <h2>New notebook entry</h2>
        <FormRow label="Title" wide>
          <input
            required
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Intake roller prototype #2"
          />
        </FormRow>
        <FormGrid min={160}>
          <FormRow label="Date">
            <input
              type="date"
              value={form.entryDate}
              onChange={(e) => setForm({ ...form, entryDate: e.target.value })}
            />
          </FormRow>
          <FormRow label="Phase">
            <select
              value={form.phase}
              onChange={(e) => setForm({ ...form, phase: e.target.value as BuildPhase })}
            >
              {BUILD_PHASES.map((p) => (
                <option key={p} value={p}>
                  {BUILD_PHASE_LABEL[p]}
                </option>
              ))}
            </select>
          </FormRow>
          <FormRow label="Subsystem">
            <input
              value={form.subsystem}
              onChange={(e) => setForm({ ...form, subsystem: e.target.value })}
              placeholder="Intake"
            />
          </FormRow>
          <FormRow label="Tags (comma-separated)">
            <input
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
              placeholder="cad, test"
            />
          </FormRow>
        </FormGrid>
        <FormRow label="What did you decide / learn?" wide>
          <textarea rows={4} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
        </FormRow>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend>Photos &amp; video</legend>
          {view.imageLibrary.length === 0 ? (
            <p className="app-muted">
              No photos or videos in the media library or pit scouting yet — a text write-up is not award
              evidence.{" "}
              <a href={mediaHref}>Add a real photo or video in Media library</a>
              {" "}or <a href={scoutingHref}>pit scouting</a>.
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
        <Button variant="primary" type="submit">
          Add entry
        </Button>
      </Panel>

      <Panel>
        <h2>Subsystems</h2>
        <p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => setSubsystemFilter("")}
          >
            {subsystemFilter ? "Show all" : "All subsystems"}
          </Button>
        </p>
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
          {view.summary.subsystems.map((s) => (
            <li key={s.name}>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setSubsystemFilter(s.name === "General" ? "" : s.name)}
              >
                {s.name} · {s.count} {s.count === 1 ? "entry" : "entries"}
              </Button>
            </li>
          ))}
        </ul>
        {view.summary.phases.length > 0 ? (
          <p className="app-muted">
            {view.summary.phases.map((p) => `${BUILD_PHASE_LABEL[p.phase]}: ${p.count}`).join(" · ")}
          </p>
        ) : null}
      </Panel>

      <Panel>
        <h2>{subsystemFilter ? `${subsystemFilter} entries` : "All entries"}</h2>
        {view.entries.length === 0 ? (
          <p className="app-muted">No entries yet — document your first design decision above.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 16 }}>
            {view.entries.map((entry) => (
              <li key={entry.id}>
                <strong>{entry.title}</strong>
                <small className="app-muted" style={{ display: "block" }}>
                  {new Date(entry.entryDate).toLocaleDateString()} · {BUILD_PHASE_LABEL[entry.phase]}
                  {entry.subsystem ? ` · ${entry.subsystem}` : ""}
                  {entry.byName ? ` · ${entry.byName}` : ""}
                  {entry.tags.length ? ` · ${entry.tags.map((t) => `#${t}`).join(" ")}` : ""}
                </small>
                {entry.body ? (
                  <small className="app-muted" style={{ display: "block", whiteSpace: "pre-wrap" }}>
                    {entry.body}
                  </small>
                ) : null}
                {entry.attachments.length === 0 ? (
                  <small className="app-muted" style={{ display: "block" }}>
                    No photo or video attached — judged award evidence needs a real image or clip, not just this
                    write-up.
                  </small>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                    {entry.attachments.map((asset) => (
                      <figure key={asset.assetId} style={{ margin: 0 }}>
                        <CiteMedia asset={asset} />
                        <figcaption>
                          <small>{asset.title}</small>
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                )}
                {view.context.role !== "viewer" ? (
                  <details style={{ marginTop: 8 }}>
                    <summary>Attach photos or video</summary>
                    {view.imageLibrary.length === 0 ? (
                      <p className="app-muted">
                        Nothing to attach until a real photo or video is in the{" "}
                        <a href={mediaHref}>Media library</a> or <a href={scoutingHref}>pit scouting</a>.
                      </p>
                    ) : (
                      <>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
                            gap: 8,
                            marginTop: 8,
                          }}
                        >
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
                        <Button type="button" size="sm" variant="secondary" onClick={() => void saveEntryPhotos(entry)}>
                          Save photos &amp; video
                        </Button>
                      </>
                    )}
                  </details>
                ) : null}
                {view.context.role !== "viewer" ? (
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      title="Copy this entry into the team wiki so it outlives the season"
                      onClick={() => void promoteEntry(entry.id)}
                    >
                      Send to wiki
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="danger"
                      onClick={() => void post({ action: "delete_entry", id: entry.id }, "Entry deleted.")}
                    >
                      Delete
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <NotebookNextActions orgId={view.context.orgId} />
    </main>
  );
}
