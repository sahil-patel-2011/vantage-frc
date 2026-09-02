"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, PageHeader, Panel } from "../../../components/ui";
import { OfflineBanner } from "../../../components/offline-banner";
import { hubHref } from "../../../lib/nav/hubs";
import { withOrgHref } from "../../../lib/nav/product-nav";
import { useOnline } from "../../../lib/offline/use-online";
import { precacheScoutMedia } from "../../../lib/scout-media/client";
import type { ScoutMediaListItem, ScoutMediaListView } from "../../../lib/scout-media/types";
import { deleteSyncedMedia } from "../../../lib/scout-offline";
import { classifyLoadFailure, loadFailureCopy } from "../../../lib/ui/load-failure";
import "./pit-photos.css";

type Props = {
  orgId: string;
  eventKey: string | null;
  teamKey: string | null;
};

type TeamGroup = {
  teamKey: string;
  teamNumber: number | null;
  nickname: string | null;
  items: ScoutMediaListItem[];
};

const LAST_WALL_KEY = (orgId: string) => `vantage:pit-photos:${orgId}`;

function readCachedWall(orgId: string): ScoutMediaListView | null {
  try {
    const raw = window.localStorage.getItem(LAST_WALL_KEY(orgId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ScoutMediaListView;
    return parsed && typeof parsed === "object" && "status" in parsed ? parsed : null;
  } catch {
    return null;
  }
}

function writeCachedWall(orgId: string, view: ScoutMediaListView) {
  try {
    window.localStorage.setItem(LAST_WALL_KEY(orgId), JSON.stringify(view));
  } catch {
    /* storage full or blocked — the wall still works online */
  }
}

function groupByTeam(items: ScoutMediaListItem[]): TeamGroup[] {
  const map = new Map<string, TeamGroup>();
  for (const item of items) {
    const group = map.get(item.teamKey) ?? {
      teamKey: item.teamKey,
      teamNumber: item.teamNumber,
      nickname: item.teamNickname,
      items: [],
    };
    group.items.push(item);
    map.set(item.teamKey, group);
  }
  const sortKey = (group: TeamGroup) =>
    group.teamNumber ?? (Number(group.teamKey.replace(/^frc/i, "")) || Number.MAX_SAFE_INTEGER);
  return [...map.values()].sort((a, b) => sortKey(a) - sortKey(b));
}

function teamLabel(group: { teamKey: string; teamNumber: number | null }): string {
  return group.teamNumber != null ? String(group.teamNumber) : group.teamKey.replace(/^frc/i, "");
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export default function PitPhotosClient({ orgId, eventKey, teamKey }: Props) {
  const online = useOnline();
  const [view, setView] = useState<ScoutMediaListView | null>(null);
  const [loading, setLoading] = useState(true);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [openClientId, setOpenClientId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setErrorStatus(null);
    const cached = readCachedWall(orgId);
    if (cached && !eventKey && !teamKey) {
      setView(cached);
      setFromCache(true);
    }
    try {
      const params = new URLSearchParams({ orgId });
      if (eventKey) params.set("eventKey", eventKey);
      if (teamKey) params.set("teamKey", teamKey);
      const response = await fetch(`/api/scouting/media/list?${params}`);
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        if (!cached) {
          setError(body.error ?? `Could not load pit photos (${response.status})`);
          setErrorStatus(response.status);
        }
        return;
      }
      const fresh = (await response.json()) as ScoutMediaListView;
      setView(fresh);
      setFromCache(false);
      if (!eventKey && !teamKey) writeCachedWall(orgId, fresh);
      if (fresh.status !== "setup_required" && fresh.items.length) {
        // Warm the SW media cache so the wall survives the walk to the pits.
        void precacheScoutMedia(fresh.items.map((item) => item.thumbUrl));
      }
    } catch (fetchError) {
      if (!cached) {
        setError(fetchError instanceof Error ? fetchError.message : "Could not load pit photos");
        setErrorStatus(null);
      }
    } finally {
      setLoading(false);
    }
  }, [orgId, eventKey, teamKey]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const handleOnline = () => void load();
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [load]);

  const items = useMemo(
    () => (view && view.status !== "setup_required" ? view.items : []),
    [view],
  );
  const groups = useMemo(() => groupByTeam(items), [items]);
  const openIndex = openClientId ? items.findIndex((item) => item.clientId === openClientId) : -1;
  const openItem = openIndex >= 0 ? items[openIndex] : null;

  const step = useCallback(
    (delta: number) => {
      if (!items.length || openIndex < 0) return;
      const next = (openIndex + delta + items.length) % items.length;
      setOpenClientId(items[next]!.clientId);
    },
    [items, openIndex],
  );

  useEffect(() => {
    if (!openItem) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenClientId(null);
      else if (event.key === "ArrowRight") step(1);
      else if (event.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openItem, step]);

  async function removePhoto(item: ScoutMediaListItem) {
    if (!item.canDelete || deleting) return;
    const label = `team ${teamLabel(item)}`;
    if (!window.confirm(`Delete this photo of ${label}? The whole team loses it.`)) return;
    setDeleting(item.clientId);
    try {
      await deleteSyncedMedia(orgId, item.clientId);
      setView((current) => {
        if (!current || current.status === "setup_required") return current;
        const remaining = current.items.filter((row) => row.clientId !== item.clientId);
        const next = { ...current, items: remaining, status: remaining.length ? "live" : "empty" } as ScoutMediaListView;
        if (!eventKey && !teamKey) writeCachedWall(orgId, next);
        return next;
      });
      if (openClientId === item.clientId) setOpenClientId(null);
      setMessage("Photo deleted for the whole team.");
    } catch (deleteError) {
      setMessage(deleteError instanceof Error ? deleteError.message : "Could not delete this photo");
    } finally {
      setDeleting(null);
    }
  }

  const scoutingHref = hubHref("/competition", "scouting", orgId);
  const failure =
    error
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus,
            message: error,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined" ? null : `${window.location.pathname}${window.location.search}`,
            message: error,
          },
        )
      : null;

  const liveView = view && view.status !== "setup_required" ? view : null;

  return (
    <main className="module-page pit-photos-page">
      <PageHeader
        breadcrumbs="Competition / Scouting / Pit photos"
        title="Pit photos"
        description={
          liveView
            ? `${liveView.eventKey}${liveView.teamKey ? ` · team ${liveView.teamKey.replace(/^frc/i, "")}` : ""} · ${items.length} photo${items.length === 1 ? "" : "s"} across ${groups.length} team${groups.length === 1 ? "" : "s"}`
            : "Every robot photo your scouts capture, grouped by team for the active event."
        }
      >
        <div className="pit-photos-header-meta">
          <nav className="product-hub-related pit-photos-related" aria-label="Related competition tools">
            <a className="app-button secondary" href={scoutingHref}>
              Scouting
            </a>
            <a className="app-button secondary" href={withOrgHref("/scouting/lineup", orgId)}>
              Coverage
            </a>
            <a className="app-button secondary" href={withOrgHref("/dossier", orgId)}>
              Dossier
            </a>
          </nav>
          <button type="button" className="app-button secondary" onClick={() => void load()} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </PageHeader>

      <OfflineBanner feature="Pit photos" fromCache={fromCache} />

      {liveView ? (
        <p className="app-muted pit-photos-quota" role="status">
          Team storage: {liveView.quota.label}
          {liveView.truncated ? " · showing the newest photos only" : ""}
          {fromCache ? " · showing the last wall loaded on this device" : ""}
        </p>
      ) : null}
      {message ? (
        <p className="form-message" role="status">
          {message}
        </p>
      ) : null}

      {failure && !view ? (
        <EmptyState soft badge="Could not load" title={failure.title} description={failure.description}>
          {failure.primary ? (
            <a className="app-button" href={failure.primary.href}>
              {failure.primary.label}
            </a>
          ) : null}
          {failure.showRetry || !failure.primary ? (
            <button type="button" className="app-button secondary" onClick={() => void load()}>
              Retry
            </button>
          ) : null}
        </EmptyState>
      ) : null}

      {!failure && !view && loading ? (
        <EmptyState soft aria-busy title="Loading pit photos…" description="Fetching this event's photo wall." />
      ) : null}

      {view?.status === "setup_required" ? (
        <EmptyState soft badge="Setup required" badgeTone="setup" title="No active event" description={view.message}>
          <a className="app-button" href={withOrgHref("/competition", orgId)}>
            Set active event
          </a>
        </EmptyState>
      ) : null}

      {liveView && liveView.status === "empty" ? (
        <EmptyState
          soft
          badge="No photos yet"
          title="No pit photos for this event"
          description="Photos captured in the pit scouting form land here, grouped by team, as soon as they sync from a scout's device."
        >
          <a className="app-button" href={`${scoutingHref}&scoutTab=pit`}>
            Open pit scouting
          </a>
        </EmptyState>
      ) : null}

      {groups.map((group) => (
        <Panel key={group.teamKey} as="section" className="pit-photos-team" aria-label={`Team ${teamLabel(group)}`}>
          <header className="pit-photos-team-head">
            <div>
              <h2>Team {teamLabel(group)}</h2>
              {group.nickname ? <p className="app-muted">{group.nickname}</p> : null}
            </div>
            <div className="pit-photos-team-actions">
              <span className="app-badge">{group.items.length} photo{group.items.length === 1 ? "" : "s"}</span>
              <a
                className="text-button"
                href={withOrgHref(`/dossier?team=${encodeURIComponent(teamLabel(group))}`, orgId)}
              >
                Dossier
              </a>
            </div>
          </header>
          <ul className="pit-photos-grid">
            {group.items.map((item) => (
              <li key={item.clientId}>
                <button
                  type="button"
                  className="pit-photo-thumb"
                  onClick={() => setOpenClientId(item.clientId)}
                  aria-label={`Open photo of team ${teamLabel(group)} taken ${new Date(item.capturedAt).toLocaleString()}`}
                >
                  {/* Plain <img>: org-scoped bytes served by our route and cached by the SW. */}
                  <img
                    src={item.thumbUrl}
                    alt={`Team ${teamLabel(group)} robot`}
                    loading="lazy"
                    decoding="async"
                    width={item.thumbWidth ?? 320}
                    height={item.thumbHeight ?? 240}
                  />
                </button>
                <small className="app-muted">
                  {new Date(item.capturedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  {item.capturedByName ? ` · ${item.capturedByName}` : ""}
                </small>
              </li>
            ))}
          </ul>
        </Panel>
      ))}

      {openItem ? (
        <div
          className="pit-photo-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`Photo of team ${teamLabel(openItem)}`}
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpenClientId(null);
          }}
        >
          <div className="pit-photo-lightbox-card">
            <header className="pit-photo-lightbox-head">
              <div>
                <strong>Team {teamLabel(openItem)}</strong>
                {openItem.teamNickname ? <span className="app-muted"> · {openItem.teamNickname}</span> : null}
              </div>
              <button type="button" className="text-button" onClick={() => setOpenClientId(null)} aria-label="Close">
                Close
              </button>
            </header>
            <div className="pit-photo-lightbox-stage">
              <button type="button" className="pit-photo-nav" onClick={() => step(-1)} aria-label="Previous photo" disabled={items.length < 2}>
                ‹
              </button>
              <img src={openItem.url} alt={`Team ${teamLabel(openItem)} robot, full size`} />
              <button type="button" className="pit-photo-nav" onClick={() => step(1)} aria-label="Next photo" disabled={items.length < 2}>
                ›
              </button>
            </div>
            <footer className="pit-photo-lightbox-meta">
              <dl>
                <div>
                  <dt>Captured</dt>
                  <dd>{new Date(openItem.capturedAt).toLocaleString()}</dd>
                </div>
                <div>
                  <dt>By</dt>
                  <dd>{openItem.capturedByName ?? "Team member"}</dd>
                </div>
                <div>
                  <dt>Size</dt>
                  <dd>
                    {openItem.width && openItem.height ? `${openItem.width}×${openItem.height} · ` : ""}
                    {formatBytes(openItem.byteSize)}
                  </dd>
                </div>
                <div>
                  <dt>Linked</dt>
                  <dd>{openItem.entryId ? "Pit entry synced" : openItem.entryClientId ? "Waiting for pit entry" : "Standalone photo"}</dd>
                </div>
              </dl>
              <div className="pit-photo-lightbox-actions">
                <span className="app-muted">
                  {openIndex + 1} / {items.length}
                </span>
                {openItem.canDelete ? (
                  <button
                    type="button"
                    className="app-button secondary danger"
                    disabled={deleting === openItem.clientId || !online}
                    onClick={() => void removePhoto(openItem)}
                    title={online ? "Delete for the whole team" : "Reconnect to delete"}
                  >
                    {deleting === openItem.clientId ? "Deleting…" : "Delete photo"}
                  </button>
                ) : null}
              </div>
            </footer>
          </div>
        </div>
      ) : null}
    </main>
  );
}
