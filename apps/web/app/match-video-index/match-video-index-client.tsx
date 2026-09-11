"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import {
  EmptyState,
  ErrorState,
  FormGrid,
  FormRow,
  PageHeader,
  Panel,
  SoftBlockSkeleton,
  StatTile, Button } from "../../components/ui";
import { matchVideoSourceLabel } from "../../lib/match-video-index";
import {
  MATCH_VIDEO_SOURCES,
  type MatchVideoIndexView,
} from "../../lib/match-video-index/compute-match-video-index";
import type { MatchVideoSource } from "../../lib/match-video-index/types";
import {
  MATCH_VIDEO_INDEX_RELATED_INCLUDE,
  classifyMatchVideoIndexShell,
  formatMatchVideoIndexMetric,
  matchVideoIndexNextActions,
  matchVideoIndexRelatedLinks,
  matchVideoIndexSetupSteps,
  matchVideoIndexShellCopy,
  shouldShowMatchVideoIndexSummaryTiles,
  type MatchVideoIndexNextAction,
  type MatchVideoIndexShellKind,
} from "../../lib/match-video-index/match-video-index-related";
import { hubWorkbenchHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import "./match-video-index.css";

function isMatchVideoIndexView(value: unknown): value is MatchVideoIndexView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

async function persistMatchVideoIndexSnapshot(orgHint: string, data: MatchVideoIndexView): Promise<void> {
  const cacheOrg =
    "orgId" in data && typeof data.orgId === "string" && data.orgId.trim() ? data.orgId : orgHint;
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("match-video-index", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("match-video-index", "_", data);
  } catch {
    // Live index already painted; IndexedDB is best-effort.
  }
}

type LiveView = Extract<MatchVideoIndexView, { status: "live" }>;

function RelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = matchVideoIndexRelatedLinks(orgId, {
    include: [...MATCH_VIDEO_INDEX_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related mvi-related" aria-label="Related competition tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

function NextActionsPanel({ actions }: { actions: MatchVideoIndexNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions mvi-next-actions" aria-label="Next actions">
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

function IndexShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: MatchVideoIndexShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = matchVideoIndexNextActions({ orgId, shell });
  const copy = matchVideoIndexShellCopy(shell);
  const competitionHref = hubWorkbenchHref("competition", "match-video-index", orgId);
  const setup = shell === "setup" ? matchVideoIndexSetupSteps(orgId)[0] : null;

  return (
    <main className="module-page mvi-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Match Video Index"}
          </>
        }
        title="Match Video Index"
        description={description}
      >
        <RelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      {shell === "loading" ? (
        <div aria-busy="true" aria-label="Loading Match Video Index">
          <SoftBlockSkeleton lines={4} />
        </div>
      ) : shell === "error" ? (
        <ErrorState message={error ?? copy.description} onRetry={onRetry} />
      ) : (
        <EmptyState
          soft
          badge={shell === "setup" ? "Needs setup" : copy.badge}
          badgeTone="setup"
          title={copy.title}
          description={error ?? copy.description}
        >
          {setup ? (
            <Button as="a" variant="primary" href={setup.href}>
              {setup.label}
            </Button>
          ) : null}
          {shell === "empty" ? (
            <Button as="a" variant="primary" href="#match-video-index-add">Add a match video</Button>
          ) : null}
        </EmptyState>
      )}
      {shell === "ready" ? <NextActionsPanel actions={actions} /> : null}
    </main>
  );
}

export default function MatchVideoIndexClient() {
  const [view, setView] = useState<MatchVideoIndexView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<MatchVideoIndexView | null>(null);
  viewRef.current = view;

  const load = useCallback(() => {
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const urlOrg = params.get("orgId")?.trim() ?? "";
      let hadCache = Boolean(viewRef.current);
      try {
        const cached = await getFeatureSnapshot<MatchVideoIndexView>("match-video-index", urlOrg || "_");
        if (!viewRef.current && cached?.data && isMatchVideoIndexView(cached.data)) {
          setView(cached.data);
          setFromCache(true);
          setCachedAt(cached.cachedAt);
          hadCache = true;
        }
      } catch {
        // IndexedDB missing or blocked; live fetch still runs.
      }
      setFetchFailed(false);
      setError("");
      const query = new URLSearchParams();
      if (urlOrg) query.set("orgId", urlOrg);
      try {
        const response = await fetch(
          `/api/match-video-index${query.toString() ? `?${query.toString()}` : ""}`,
          {
            cache: "no-store",
            signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
          },
        );
        const data = (await response.json()) as MatchVideoIndexView | { error?: string };
        if (!response.ok || !isMatchVideoIndexView(data)) {
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setError("Could not refresh the match video index. Showing the last copy on this device.");
            setFetchFailed(false);
          } else {
            setFetchFailed(true);
          }
          return;
        }
        setView(data);
        setFromCache(false);
        setCachedAt(null);
        await persistMatchVideoIndexSnapshot(urlOrg, data);
      } catch {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh the match video index. Showing the last copy on this device.");
          setFetchFailed(false);
        } else {
          setFetchFailed(true);
        }
      }
    })();
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const orgId = view && "orgId" in view ? view.orgId : null;
  const videoCount = view?.status === "live" ? view.summary.totalVideos : 0;
  const matchCount = view?.status === "live" ? view.summary.totalMatches : 0;

  const shell = classifyMatchVideoIndexShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
    videoCount,
  });
  const shellCopy = matchVideoIndexShellCopy(shell);
  const nextActions = matchVideoIndexNextActions({
    orgId,
    shell: shell === "empty" ? "ready" : shell,
    videoCount,
  });
  const competitionHref = hubWorkbenchHref("competition", "match-video-index", orgId);
  const showTiles = shouldShowMatchVideoIndexSummaryTiles(videoCount, matchCount);
  const loaded = view?.status === "live";

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/match-video-index", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as MatchVideoIndexView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        void persistMatchVideoIndexSnapshot(orgId, data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy],
  );

  if (shell === "loading") {
    return (
      <IndexShell description={shellCopy.description} orgId={null} shell="loading">
        <OfflineBanner feature="Match video index" fromCache={fromCache} cachedAt={cachedAt} />
      </IndexShell>
    );
  }
  if (shell === "error") {
    return (
      <IndexShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      >
        <OfflineBanner feature="Match video index" fromCache={fromCache} cachedAt={cachedAt} />
      </IndexShell>
    );
  }
  if (shell === "setup" || view?.status !== "live") {
    return (
      <IndexShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      >
        <OfflineBanner feature="Match video index" fromCache={fromCache} cachedAt={cachedAt} />
      </IndexShell>
    );
  }

  return (
    <main className="module-page mvi-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Match Video Index"}
          </>
        }
        title="Match Video Index"
        description="Auto-index your match videos by match key for quick review. Cross-check Scouting and Match Notes."
      >
        <RelatedStrip orgId={orgId} />
      </PageHeader>

      <OfflineBanner feature="Match video index" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {showTiles ? (
        <Panel className="mvi-panel">
          <div className="mvi-stats">
            <StatTile label="Videos indexed" value={formatMatchVideoIndexMetric(videoCount, loaded)} />
            <StatTile label="Matches covered" value={formatMatchVideoIndexMetric(matchCount, loaded)} />
            <StatTile
              label="Top source"
              value={
                view.summary.bySource[0]
                  ? matchVideoSourceLabel(view.summary.bySource[0].source)
                  : "—"
              }
            />
          </div>
        </Panel>
      ) : null}

      <AddVideoForm busy={busy} mutate={mutate} />
      <VideoGroups view={view} busy={busy} mutate={mutate} />
      <NextActionsPanel actions={nextActions} />
    </main>
  );
}

function VideoGroups({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.summary.totalVideos === 0) {
    return (
      <EmptyState
        soft
        badge="No videos yet"
        badgeTone="setup"
        title="Index your first match video"
        description="Add a video link with its match key."
      />
    );
  }
  return (
    <Panel id="match-video-index-groups" className="mvi-panel">
      <h2>Videos by match</h2>
      <div className="mvi-groups">
        {view.groups.map((group) => (
          <div key={group.matchKey}>
            <strong>{group.matchLabel ?? group.matchKey}</strong>
            <small className="app-muted mvi-block">
              {group.matchKey}
              {group.eventKey ? ` · ${group.eventKey}` : ""}
            </small>
            <ul className="mvi-video-list">
              {group.videos.map((video) => (
                <li key={video.id} className="mvi-video-row">
                  <div>
                    <a href={video.videoUrl} target="_blank" rel="noreferrer" className="mvi-url">
                      {video.videoUrl}
                    </a>
                    <small className="app-muted mvi-block">
                      {matchVideoSourceLabel(video.source)}
                      {video.recordedOn ? ` · ${video.recordedOn}` : ""}
                      {video.tags.length ? ` · ${video.tags.join(", ")}` : ""}
                    </small>
                    {video.notes ? <small className="app-muted">{video.notes}</small> : null}
                  </div>
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    aria-label={`Remove video ${video.videoUrl} from ${group.matchLabel ?? group.matchKey}`}
                    onClick={() => {
                      if (window.confirm("Remove this video from the index?")) {
                        mutate({ action: "delete-video", entryId: video.id });
                      }
                    }}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function AddVideoForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      matchKey: "",
      eventKey: "",
      matchLabel: "",
      videoUrl: "",
      source: "youtube" as MatchVideoSource,
      recordedOn: "",
      notes: "",
      tags: "",
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      id="match-video-index-add"
      as="form"
      className="mvi-panel"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.matchKey.trim() || !form.videoUrl.trim()) return;
        mutate({
          action: "add-video",
          matchKey: form.matchKey,
          eventKey: form.eventKey || undefined,
          matchLabel: form.matchLabel || undefined,
          videoUrl: form.videoUrl,
          source: form.source,
          recordedOn: form.recordedOn || undefined,
          notes: form.notes || undefined,
          tags: form.tags
            ? form.tags
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean)
            : [],
        });
        setForm(empty);
      }}
    >
      <h2>Add video</h2>
      <p className="app-muted">Real URLs and match keys only.</p>
      <FormGrid min={160}>
        <FormRow label="Match key">
          <input value={form.matchKey} onChange={set("matchKey")} placeholder="2026casj_qm12" required />
        </FormRow>
        <FormRow label="Match label (optional)">
          <input value={form.matchLabel} onChange={set("matchLabel")} placeholder="Qual 12" />
        </FormRow>
        <FormRow label="Event key (optional)">
          <input value={form.eventKey} onChange={set("eventKey")} placeholder="2026casj" />
        </FormRow>
        <FormRow label="Video URL">
          <input value={form.videoUrl} onChange={set("videoUrl")} placeholder="https://youtu.be/..." required />
        </FormRow>
        <FormRow label="Source">
          <select value={form.source} onChange={set("source")}>
            {MATCH_VIDEO_SOURCES.map((source) => (
              <option key={source} value={source}>
                {matchVideoSourceLabel(source)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Recorded on (optional)">
          <input type="date" value={form.recordedOn} onChange={set("recordedOn")} />
        </FormRow>
        <FormRow label="Tags (comma separated, optional)">
          <input value={form.tags} onChange={set("tags")} placeholder="defense, endgame" />
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </FormRow>
      <div>
        <Button variant="primary" type="submit" disabled={busy || !form.matchKey.trim() || !form.videoUrl.trim()}>
          Add video
        </Button>
      </div>
    </Panel>
  );
}
